"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { clinicalPatientWhere, isAgendaPlaceholderPatient } from "@/lib/patient-clinical-scope";
import { scheduleCrmAccountSync } from "@/lib/crm/touch";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getAuthenticatedDbUserId } from "@/lib/patient-ownership";
import { canCreateEvolution, canAddPatient, isStarterOrAbove, hasAdminRole, canUseOfficeFinance } from "@/lib/plan-limits";
import { sanitizeText } from "@/lib/sanitize";
import { matchSimilarPatients } from "@/lib/similar-patient-match";
import { emptyToNull, updatePatientProfileSchema } from "@/lib/patient-profile";
import { resolveBirthAndAgeForPersist, resolvePatientAgeLabel, dateOfBirthToIso } from "@/lib/patient-age";
import {
  contactsFromProfileForm,
  mergeOptionalContactsKeepExisting,
  type PatientOptionalContacts,
  type PatientOptionalContactsInput,
} from "@/lib/patient-optional-contacts";
import {
  API_V1_READ_RATE_LIMIT,
  enforceRateLimit,
  PATIENT_PROFILE_UPDATE_RATE_LIMIT,
} from "@/lib/rate-limit";
import {
  formatMedicationsAndSupplementsForDocument,
  medicationsAndSupplementsStoredSchema,
  patientHandoutStoredSchema,
  professionalActionsStoredSchema,
} from "@/lib/evolution-artifacts";
import type {
  MedicationsAndSupplementsStored,
  PatientHandoutStored,
  ProfessionalActionsStored,
} from "@/lib/evolution-artifacts";
import {
  BULLET_MAX_LEN,
  BULLETS_MAX_COUNT,
  buildClinicalCaseHighlightsFromBullets,
  buildManualClinicalReview,
  CLINICAL_SUMMARY_MAX_LEN,
  dropRejectedItems,
  parseClinicalCaseHighlightsReviewMeta,
  parseClinicalCaseHighlightsStored,
  splitSummarySentences,
} from "@/lib/clinical-case-highlights";
import {
  CLINICAL_STRICT_EXTRACTION_POLICY,
  clinicalGenerationConfig,
  clipAtSentenceBoundary,
  filterGroundedBullets,
  normalizeNotInformed,
} from "@/lib/clinical-harness";
import { onEvolutionRecorded } from "@/lib/finance/reconcile-session";
import type { EvolutionSessionConsumptionSummary } from "@/lib/finance/evolution-session-consumption";
import { runAppointmentCompletionFinanceEffects } from "@/lib/finance/appointment-income";
import { attendanceDateToSaoPauloNoon } from "@/lib/finance/portuguese-payment";
import {
  assertAppointmentReadyForNewEvolution,
  evaluateAppointmentEvolutionEligibility,
  formatAppointmentSlotLabel,
  loadAppointmentForEvolutionLink,
} from "@/server/services/appointment-evolution-link";
import { scheduleGoogleCalendarPush } from "@/lib/google-calendar-push";
import { notifyNewProfessionalActionsFromEvolution, maybeNotifyPackageNearEndFromConsumption } from "@/lib/push-notifications/dispatch";
import { AppointmentStatus, PatientServiceSessionStatus } from "@prisma/client";
import {
  listPatientsForUser,
  type PatientWithLastEvolution,
} from "@/server/services/patients";
import {
  normalizePatientAgendaColorInput,
  resolvePatientAgendaColor,
} from "@/lib/patient-agenda-color";
import { evolutionRowToCopyDraft, type EvolutionCopyDraft } from "@/lib/evolution-copy-draft";
import {
  EVOLUTION_FORM_META_KEYS,
  mergeFormFieldsIntoClinicalMeta,
} from "@/lib/evolution-copy-draft";
import {
  getPatientAccessScope,
  ownerIdForNewPatient,
  assertPatientAccessible,
  PROFILE_REQUIRED_ERROR,
} from "@/lib/intra-user/patient-access";
import { buildPatientScopeWhere, scopedPatientWhereOrEmpty, type ActiveIntraUser } from "@/lib/intra-user/patient-scope";

function persistOptionalContacts(c: PatientOptionalContacts): PatientOptionalContacts {
  const name = (v: string | null) => (v ? sanitizeText(v) || null : null);
  return {
    phone: c.phone,
    fatherName: name(c.fatherName),
    motherName: name(c.motherName),
    companionName: name(c.companionName),
    companionPhone: c.companionPhone,
  };
}

function optionalContactsFromEvolutionInput(
  data: PatientOptionalContactsInput,
  existing?: PatientOptionalContacts | null,
): PatientOptionalContacts {
  return persistOptionalContacts(mergeOptionalContactsKeepExisting(data, existing));
}

export type { PatientWithLastEvolution };

// Lazy-loaded: pesados para cold-start serverless; carregados só quando necessários
async function lazyGemini() {
  const { getGeminiModel } = await import("@/lib/gemini");
  return getGeminiModel;
}

// Interface para evolução
export interface EvolutionSummary {
  id: string;
  date: Date;
  content: string | null;
  pdfUrl: string | null;
}

// Resultado da listagem de pacientes
export interface GetPatientsResult {
  success: boolean;
  patients?: PatientWithLastEvolution[];
  error?: string;
}

// Resultado das evoluções de um paciente
export interface GetPatientEvolutionsResult {
  success: boolean;
  patient?: {
    id: string;
    name: string;
    age: string | null;
    diagnosis: string | null;
  };
  evolutions?: EvolutionSummary[];
  error?: string;
}

// Função auxiliar para obter o usuário logado
async function getAuthenticatedUser() {
  const supabase = await createSupabaseServerClient();
  const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();

  if (authError || !authUser) {
    return null;
  }

  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [
        { authUserId: authUser.id },
        { email: authUser.email ?? "" },
      ],
    },
    select: { id: true },
  });

  return dbUser;
}

/** Leitura isolada do JSON de tópicos — se a coluna não existir (migração pendente), falha silenciosa. */
async function fetchPatientClinicalCaseHighlightsJson(
  patientId: string
): Promise<unknown> {
  try {
    const rows = await prisma.$queryRaw<{ clinical_case_highlights: unknown }[]>`
      SELECT "clinical_case_highlights" FROM "Patient" WHERE "id" = ${patientId} LIMIT 1
    `;
    return rows[0]?.clinical_case_highlights;
  } catch {
    return undefined;
  }
}

// Listar pacientes do usuário logado com primeira e última evolução
export async function getMyPatients(): Promise<GetPatientsResult> {
  try {
    const dbUser = await getAuthenticatedUser();

    if (!dbUser) {
      return {
        success: false,
        error: "Usuário não autenticado.",
      };
    }

    const scope = await getPatientAccessScope();
    if (!scope || scope.denied) {
      return { success: false, error: PROFILE_REQUIRED_ERROR };
    }
    const patients = await listPatientsForUser(dbUser.id, scope.activeIntraUser);

    return {
      success: true,
      patients,
    };
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : typeof error === "string" ? error : "unknown";
    console.error("Erro ao listar pacientes:", detail, error);
    return {
      success: false,
      error: "Erro ao carregar pacientes.",
    };
  }
}

// Buscar evoluções de um paciente específico
export async function getPatientEvolutions(patientId: string): Promise<GetPatientEvolutionsResult> {
  try {
    const dbUser = await getAuthenticatedUser();

    if (!dbUser) {
      return {
        success: false,
        error: "Usuário não autenticado.",
      };
    }

    // Garante Tenant + segregação por Intra User (owner/compartilhado ou ADMIN).
    const evoScope = await getPatientAccessScope();
    if (!evoScope || evoScope.denied) {
      return { success: false, error: PROFILE_REQUIRED_ERROR };
    }
    const evoScopeWhere = buildPatientScopeWhere(evoScope);
    const patient = await prisma.patient.findFirst({
      where: {
        ...evoScopeWhere,
        id: patientId,
      },
      select: {
        id: true,
        name: true,
        age: true,
        diagnosis: true,
      },
    });

    if (!patient) {
      return {
        success: false,
        error: "Paciente não encontrado ou acesso negado.",
      };
    }

    // Buscar evoluções ordenadas por data (mais recente primeiro)
    const evolutions = await prisma.evolution.findMany({
      where: { patientId: patient.id },
      orderBy: { date: 'desc' },
      select: {
        id: true,
        date: true,
        content: true,
        pdfUrl: true,
      },
    });

    return {
      success: true,
      patient,
      evolutions,
    };
  } catch (error) {
    console.error("Erro ao buscar evoluções:", error);
    return {
      success: false,
      error: "Erro ao carregar evoluções.",
    };
  }
}

export interface CreatePatientInput {
  nome: string;
  idade?: string;
  dataNascimento?: string;
  diagnostico?: string;
  historico?: string;
  telefone?: string;
  nomePai?: string;
  nomeMae?: string;
  nomeAcompanhante?: string;
  telefoneAcompanhante?: string;
}

export interface CreatePatientResult {
  success: boolean;
  patientId?: string;
  error?: string;
}

export async function createPatient(
  data: CreatePatientInput
): Promise<CreatePatientResult> {
  try {
    // Validação básica
    if (!data.nome || data.nome.trim().length === 0) {
      return {
        success: false,
        error: "Nome do paciente é obrigatório",
      };
    }

    // Obter o usuário logado
    const supabase = await createSupabaseServerClient();
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();

    if (authError || !authUser) {
      return {
        success: false,
        error: "Usuário não autenticado. Faça login para criar pacientes.",
      };
    }

    // Buscar o userId no banco Prisma
    const dbUser = await prisma.user.findFirst({
      where: {
        OR: [
          { authUserId: authUser.id },
          { email: authUser.email ?? "" },
        ],
      },
      select: { id: true },
    });

    if (!dbUser) {
      return {
        success: false,
        error: "Usuário não encontrado no sistema.",
      };
    }

    // Criar paciente vinculado ao Tenant e ao Intra User (profissional) que o criou.
    const scope = await getPatientAccessScope();
    if (!scope || scope.denied || !scope.activeIntraUser) {
      return { success: false, error: PROFILE_REQUIRED_ERROR };
    }
    const ownerId = ownerIdForNewPatient(scope);
    const birthAge = resolveBirthAndAgeForPersist({
      incomingBirthIso: data.dataNascimento,
      incomingAge: data.idade,
    });
    const contacts = persistOptionalContacts(
      contactsFromProfileForm({
        telefone: data.telefone,
        nomePai: data.nomePai,
        nomeMae: data.nomeMae,
        nomeAcompanhante: data.nomeAcompanhante,
        telefoneAcompanhante: data.telefoneAcompanhante,
      }),
    );
    const patient = await prisma.patient.create({
      data: {
        name: data.nome.trim(),
        age: birthAge.age,
        dateOfBirth: birthAge.dateOfBirth,
        diagnosis: data.diagnostico?.trim() || null,
        history: data.historico?.trim() || null,
        ...contacts,
        userId: dbUser.id, // Vincula ao Tenant (conta pagante)
        ownerId, // Profissional dono (segregação intra-tenant)
      },
    });

    // Revalidar a página de pacientes
    revalidatePath("/dashboard/patients");

    return {
      success: true,
      patientId: patient.id,
    };
  } catch (error) {
    console.error("Erro ao criar paciente:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Erro desconhecido ao criar paciente",
    };
  }
}

// Interface para salvar evolução
export interface SaveEvolutionInput {
  patientName: string;
  patientAge?: string;
  /** YYYY-MM-DD — fonte da idade automática na ficha. */
  patientDateOfBirth?: string;
  patientDiagnosis?: string;
  telefone?: string;
  nomePai?: string;
  nomeMae?: string;
  nomeAcompanhante?: string;
  telefoneAcompanhante?: string;
  /** Queixa principal do formulário (persistida em clinicalMeta.formQueixa). */
  patientQueixa?: string;
  /** Conduta do formulário (persistida em clinicalMeta.formConduta). */
  patientConduta?: string;
  attendanceDate?: string;
  content: string;
  examsAnalysis?: string;
  pdfUrl?: string;
  clinicalMeta?: Record<string, string | undefined>; // Metadados clínicos da IA
  linkedPatientId?: string; // ID do paciente existente para vincular (detecção de similares)
  /** Marcação de origem (evoluir do slot na agenda). */
  appointmentId?: string;
  /** Checklist do profissional (JSON validado em evolution-artifacts). */
  professionalActions?: import("@/lib/evolution-artifacts").ProfessionalActionsStored;
  /** Handout para o paciente (JSON validado). */
  patientHandout?: import("@/lib/evolution-artifacts").PatientHandoutStored;
  /** Medicamentos e suplementos mencionados (JSON validado). */
  medicationsAndSupplements?: import("@/lib/evolution-artifacts").MedicationsAndSupplementsStored;
  /**
   * Quando true, não debita sessão automaticamente aqui — a Nova Evolução
   * fará createPatientPurchase com consumeFirstSessionAt em seguida.
   * Evita corrida com onEvolutionRecorded (fire-and-forget) debitando outro pacote.
   */
  deferAutomaticSessionConsumption?: boolean;
}

export interface SaveEvolutionResult {
  success: boolean;
  evolutionId?: string;
  patientId?: string;
  isNewPatient?: boolean;
  error?: string;
  /** Baixa automática da próxima sessão do plano ativo (data da evolução). */
  sessionConsumption?: EvolutionSessionConsumptionSummary;
}

// Salvar evolução (cria paciente se não existir)
export async function saveEvolution(
  data: SaveEvolutionInput,
  options?: { dbUserId?: string; activeIntraUser?: ActiveIntraUser | null },
): Promise<SaveEvolutionResult> {
  try {
    const parseAttendanceDate = (raw?: string): Date | null =>
      attendanceDateToSaoPauloNoon(raw);

    // Validação básica
    if (!data.patientName || data.patientName.trim().length === 0) {
      return {
        success: false,
        error: "Nome do paciente é obrigatório para salvar a evolução.",
      };
    }

    // Obter usuário autenticado (cookie web ou dbUserId explícito — API v1 mobile)
    const dbUser = options?.dbUserId
      ? await prisma.user.findUnique({
          where: { id: options.dbUserId },
          select: { id: true, plan: true, email: true, isInfluencer: true },
        })
      : await (async () => {
          const supabase = await createSupabaseServerClient();
          const {
            data: { user: authUser },
            error: authError,
          } = await supabase.auth.getUser();
          if (authError || !authUser) return null;
          return prisma.user.findFirst({
            where: {
              OR: [{ authUserId: authUser.id }, { email: authUser.email ?? "" }],
            },
            select: { id: true, plan: true, email: true, isInfluencer: true },
          });
        })();

    if (!dbUser) {
      return {
        success: false,
        error: "Usuário não autenticado.",
      };
    }

    // Segregação Intra User: API v1 passa activeIntraUser; web resolve do cookie.
    const saveScope = options?.dbUserId
      ? {
          tenantId: dbUser.id,
          activeIntraUser: options.activeIntraUser ?? null,
          denied: !options.activeIntraUser,
        }
      : await getPatientAccessScope();
    if (!saveScope || saveScope.denied || !saveScope.activeIntraUser) {
      return { success: false, error: PROFILE_REQUIRED_ERROR };
    }
    const activeIntraUserId = saveScope.activeIntraUser.id;
    const patientScopeWhere = buildPatientScopeWhere(saveScope);

    // Feature gating: verificar limites do plano (Super Admin ignora)
    const userForLimit = await prisma.user.findUnique({
      where: { id: dbUser.id },
      select: {
        plan: true,
        isInfluencer: true,
        evolutionCount: true,
        evolutionCountResetAt: true,
        patientCount: true,
        email: true,
      },
    });
    if (!userForLimit) {
      return { success: false, error: "Usuário não encontrado." };
    }

    // Lazy reset mensal: se mudou o mês, zerar evolutionCount
    let effectiveEvolutionCount = userForLimit.evolutionCount;
    const now = new Date();
    const lastReset = userForLimit.evolutionCountResetAt;
    if (
      !lastReset ||
      lastReset.getUTCMonth() !== now.getUTCMonth() ||
      lastReset.getUTCFullYear() !== now.getUTCFullYear()
    ) {
      await prisma.user.update({
        where: { id: dbUser.id },
        data: { evolutionCount: 0, evolutionCountResetAt: now },
      });
      effectiveEvolutionCount = 0;
    }

    if (
      !canCreateEvolution(
        userForLimit.plan,
        effectiveEvolutionCount,
        userForLimit.email,
        userForLimit.isInfluencer
      )
    ) {
      return {
        success: false,
        error: "Limite de evoluções atingido. Faça upgrade para continuar.",
      };
    }

    const appointmentIdTrimmed = data.appointmentId?.trim() || null;
    let linkedAppointment: {
      id: string;
      status: AppointmentStatus;
      startAt: Date;
      timezoneAtBooking: string;
      patientServiceSessionId: string | null;
    } | null = null;
    let appointmentOriginalPatientId: string | null = null;

    const patientName = data.patientName.trim();
    let isNewPatient = false;

    // Se há um linkedPatientId, usar diretamente o paciente existente
    let patient = null;

    if (appointmentIdTrimmed) {
      const apptLoaded = await loadAppointmentForEvolutionLink(
        dbUser.id,
        appointmentIdTrimmed,
      );
      if (!apptLoaded.success) {
        return { success: false, error: apptLoaded.error };
      }
      const appt = apptLoaded.data;
      const eligibility = evaluateAppointmentEvolutionEligibility(appt);
      if (!eligibility.canStartEvolution) {
        return {
          success: false,
          error: eligibility.blockReason ?? "Marcação indisponível.",
        };
      }
      linkedAppointment = {
        id: appt.id,
        status: appt.status,
        startAt: appt.startAt,
        timezoneAtBooking: appt.timezoneAtBooking,
        patientServiceSessionId: appt.patientServiceSessionId,
      };
      appointmentOriginalPatientId = appt.patientId;

      if (isAgendaPlaceholderPatient(appt.patient)) {
        const forcedPatientId = data.linkedPatientId?.trim();
        if (forcedPatientId) {
          const apptAssert = await assertAppointmentReadyForNewEvolution(
            dbUser.id,
            appointmentIdTrimmed,
            forcedPatientId,
          );
          if (!apptAssert.success) {
            return { success: false, error: apptAssert.error };
          }
          patient = await prisma.patient.findFirst({
            where: { ...patientScopeWhere, id: forcedPatientId, ...clinicalPatientWhere },
          });
          if (!patient) {
            return { success: false, error: "Paciente selecionado não encontrado." };
          }
        }
      } else {
        const forcedPatientId = data.linkedPatientId?.trim();
        if (forcedPatientId) {
          const apptAssert = await assertAppointmentReadyForNewEvolution(
            dbUser.id,
            appointmentIdTrimmed,
            forcedPatientId,
          );
          if (!apptAssert.success) {
            return { success: false, error: apptAssert.error };
          }
          patient = await prisma.patient.findFirst({
            where: { ...patientScopeWhere, id: forcedPatientId, ...clinicalPatientWhere },
          });
          if (!patient) {
            return { success: false, error: "Paciente selecionado não encontrado." };
          }
        } else {
          patient = await prisma.patient.findFirst({
            where: { ...patientScopeWhere, id: appt.patientId },
          });
          if (!patient) {
            return { success: false, error: "Paciente da marcação não encontrado." };
          }
        }
      }

      if (patient) {
        console.log(
          `✅ [saveEvolution] Evolução vinculada à marcação ${appointmentIdTrimmed} (${patient.name})`,
        );
      }
    } else if (data.linkedPatientId) {
      patient = await prisma.patient.findFirst({
        where: {
          ...patientScopeWhere,
          id: data.linkedPatientId,
        },
      });
      if (patient) {
        console.log(`✅ [saveEvolution] Vinculando evolução ao paciente existente: ${patient.name} (${patient.id})`);
      }
    }

    // Se não vinculou, verificar se já existe um paciente clínico com este nome
    if (!patient) {
      patient = await prisma.patient.findFirst({
        where: {
          ...patientScopeWhere,
          ...clinicalPatientWhere,
          name: {
            equals: patientName,
            mode: 'insensitive', // Case insensitive
          },
        },
      });
    }

    // Placeholder da agenda: promover a ficha clínica (não criar duplicata).
    if (
      !patient &&
      appointmentIdTrimmed &&
      appointmentOriginalPatientId
    ) {
      const placeholder = await prisma.patient.findFirst({
        where: {
          ...patientScopeWhere,
          id: appointmentOriginalPatientId,
          agendaOnly: true,
        },
      });
      if (placeholder) {
        if (
          !canAddPatient(
            userForLimit.plan,
            userForLimit.patientCount,
            userForLimit.email,
            userForLimit.isInfluencer,
          )
        ) {
          return {
            success: false,
            error: "Limite de pacientes atingido. Faça upgrade para cadastrar mais pacientes.",
          };
        }
        patient = await prisma.patient.update({
          where: { id: placeholder.id },
          data: {
            agendaOnly: false,
            name: patientName,
            ...resolveBirthAndAgeForPersist({
              incomingBirthIso: data.patientDateOfBirth,
              existingBirth: placeholder.dateOfBirth,
              incomingAge: data.patientAge,
              existingAge: placeholder.age,
            }),
            diagnosis: data.patientDiagnosis?.trim() || placeholder.diagnosis,
            ...optionalContactsFromEvolutionInput(
              {
                telefone: data.telefone,
                nomePai: data.nomePai,
                nomeMae: data.nomeMae,
                nomeAcompanhante: data.nomeAcompanhante,
                telefoneAcompanhante: data.telefoneAcompanhante,
              },
              placeholder,
            ),
            ...(activeIntraUserId && !placeholder.ownerId
              ? { ownerId: activeIntraUserId }
              : {}),
          },
        });
        await prisma.user.update({
          where: { id: dbUser.id },
          data: { patientCount: { increment: 1 } },
        });
        isNewPatient = true;
        console.log(
          `✅ [saveEvolution] Placeholder da agenda promovido a ficha clínica: ${patientName}`,
        );
      }
    }

    // Se não existir, verificar limite de pacientes e criar
    if (!patient) {
      if (
        !canAddPatient(
          userForLimit.plan,
          userForLimit.patientCount,
          userForLimit.email,
          userForLimit.isInfluencer
        )
      ) {
        return {
          success: false,
          error: "Limite de pacientes atingido. Faça upgrade para cadastrar mais pacientes.",
        };
      }
      const createdBirthAge = resolveBirthAndAgeForPersist({
        incomingBirthIso: data.patientDateOfBirth,
        incomingAge: data.patientAge,
      });
      const createdContacts = optionalContactsFromEvolutionInput({
        telefone: data.telefone,
        nomePai: data.nomePai,
        nomeMae: data.nomeMae,
        nomeAcompanhante: data.nomeAcompanhante,
        telefoneAcompanhante: data.telefoneAcompanhante,
      });
      patient = await prisma.patient.create({
        data: {
          name: patientName,
          age: createdBirthAge.age,
          dateOfBirth: createdBirthAge.dateOfBirth,
          diagnosis: data.patientDiagnosis?.trim() || null,
          ...createdContacts,
          userId: dbUser.id,
          ownerId: activeIntraUserId,
          isShared: false,
          agendaOnly: false,
        },
      });
      await prisma.user.update({
        where: { id: dbUser.id },
        data: { patientCount: { increment: 1 } },
      });
      isNewPatient = true;
      console.log(`✅ [saveEvolution] Novo paciente criado: ${patientName}`);
    } else {
      const persisted = resolveBirthAndAgeForPersist({
        incomingBirthIso: data.patientDateOfBirth,
        existingBirth: patient.dateOfBirth,
        incomingAge: data.patientAge,
        existingAge: patient.age,
      });
      const persistedContacts = optionalContactsFromEvolutionInput(
        {
          telefone: data.telefone,
          nomePai: data.nomePai,
          nomeMae: data.nomeMae,
          nomeAcompanhante: data.nomeAcompanhante,
          telefoneAcompanhante: data.telefoneAcompanhante,
        },
        patient,
      );
      patient = await prisma.patient.update({
        where: { id: patient.id },
        data: {
          age: persisted.age,
          dateOfBirth: persisted.dateOfBirth,
          diagnosis: data.patientDiagnosis?.trim() || patient.diagnosis,
          ...persistedContacts,
        },
      });
      console.log(`✅ [saveEvolution] Paciente existente encontrado: ${patientName}`);
    }

    // Montar conteúdo completo (evolução + exames + medicamentos se houver) e sanitizar antes de persistir
    let fullContent = sanitizeText(data.content || "");
    if (data.examsAnalysis && data.examsAnalysis.trim() !== "") {
      fullContent += "\n\n---\n\nEXAMES COMPLEMENTARES:\n" + sanitizeText(data.examsAnalysis);
    }
    const medsDocText = formatMedicationsAndSupplementsForDocument(
      data.medicationsAndSupplements,
    );
    if (medsDocText) {
      fullContent += "\n\n---\n\nMEDICAMENTOS E SUPLEMENTOS:\n" + sanitizeText(medsDocText);
    }

    // Perfil Clínico: identificar ramo guarda-chuva SEM alterar o texto da evolução
    const { resolveEvolutionClinicalTags, resolveCaseDefinitionLabel } =
      await import("@/lib/clinical-profile-tags");
    const clinicalMetaForSave = mergeFormFieldsIntoClinicalMeta(data.clinicalMeta, {
      queixa: data.patientQueixa,
      conduta: data.patientConduta,
      diagnostico: data.patientDiagnosis,
    });
    const tags = resolveEvolutionClinicalTags({
      clinicalMeta: clinicalMetaForSave,
      patientDiagnosis: data.patientDiagnosis,
      storedPatientDiagnosis: patient.diagnosis,
      evolutionContent: fullContent,
    });
    if (tags.length > 0) {
      console.log(`[saveEvolution] Tags Perfil Clínico: ${tags.join(", ")}`);
    }

    // Atualização significativa da definição do caso → Patient.diagnosis (não mexe no content)
    const caseLabel = resolveCaseDefinitionLabel(
      clinicalMetaForSave,
      data.patientDiagnosis,
    );
    if (caseLabel) {
      const prevLabel = resolveCaseDefinitionLabel(null, patient.diagnosis);
      if (prevLabel !== caseLabel) {
        patient = await prisma.patient.update({
          where: { id: patient.id },
          data: { diagnosis: caseLabel },
        });
        console.log(
          `[saveEvolution] Definição do caso atualizada: ${prevLabel ?? "(vazio)"} → ${caseLabel}`,
        );
      }
    }

    // Criar a evolução COM tags
    const evolutionDate = parseAttendanceDate(data.attendanceDate) ?? new Date();

    let appointmentMarkedCompleted = false;

    const evolution = await prisma.$transaction(async (tx) => {
      const evo = await tx.evolution.create({
        data: {
          patientId: patient.id,
          appointmentId: appointmentIdTrimmed,
          attendingIntraUserId: activeIntraUserId,
          content: fullContent,
          pdfUrl: data.pdfUrl || null,
          date: evolutionDate,
          tags: tags,
          clinicalMeta: clinicalMetaForSave || undefined,
          professionalActions: data.professionalActions
            ? (JSON.parse(JSON.stringify(data.professionalActions)) as object)
            : undefined,
          patientHandout: data.patientHandout
            ? (JSON.parse(JSON.stringify(data.patientHandout)) as object)
            : undefined,
          medicationsAndSupplements: data.medicationsAndSupplements
            ? (JSON.parse(JSON.stringify(data.medicationsAndSupplements)) as object)
            : undefined,
        },
      });

      if (
        linkedAppointment &&
        linkedAppointment.status === AppointmentStatus.SCHEDULED
      ) {
        await tx.appointment.update({
          where: { id: linkedAppointment.id },
          data: { status: AppointmentStatus.COMPLETED },
        });
        appointmentMarkedCompleted = true;
      }

      if (
        appointmentOriginalPatientId &&
        patient.id !== appointmentOriginalPatientId
      ) {
        await tx.appointment.update({
          where: { id: linkedAppointment!.id },
          data: { patientId: patient.id },
        });
        // Realizada pode ter gerado receita/consumo no placeholder — reponteia ao clínico.
        await tx.financialTransaction.updateMany({
          where: {
            appointmentId: linkedAppointment!.id,
            patientId: appointmentOriginalPatientId,
          },
          data: { patientId: patient.id },
        });
        await tx.sessionConsumptionEvent.updateMany({
          where: {
            appointmentId: linkedAppointment!.id,
            patientId: appointmentOriginalPatientId,
          },
          data: { patientId: patient.id },
        });
      }

      return evo;
    });

    // Incrementar contador mensal de evoluções do usuário
    await prisma.user.update({
      where: { id: dbUser.id },
      data: { evolutionCount: { increment: 1 } },
    });

    console.log(`✅ [saveEvolution] Evolução salva: ${evolution.id}`);

    scheduleCrmAccountSync(dbUser.id);

    // Atualizar lastVisit do paciente IMEDIATAMENTE (não depende do background task)
    await prisma.patient.update({
      where: { id: patient.id },
      data: { lastVisit: evolution.date },
    });

    // Atualizar resumo clínico do paciente (Prontuário Vivo)
    // Executar em background para não atrasar a resposta
    updatePatientSummary(patient.id).catch((err) => {
      console.error("❌ [saveEvolution] Erro ao atualizar resumo:", err);
    });

    // Revalidar páginas
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/patients");
    revalidatePath(`/dashboard/patients/${patient.id}`);
    revalidatePath("/dashboard/finances");
    if (appointmentIdTrimmed) {
      revalidatePath("/dashboard/agenda");
    }

    let sessionConsumption: EvolutionSessionConsumptionSummary | undefined;
    const mayAutoConsumeSession = canUseOfficeFinance(
      dbUser.plan,
      dbUser.email,
      dbUser.isInfluencer,
    );

    if (appointmentMarkedCompleted && linkedAppointment) {
      scheduleGoogleCalendarPush(dbUser.id, linkedAppointment.id);
      // P1: sequencial — primeiro efeitos da marcação, depois tentativa da evolução
      // (idempotente por appointmentId / evolutionId / same-day).
      try {
        await runAppointmentCompletionFinanceEffects({
          id: linkedAppointment.id,
          patientId: patient.id,
          professionalUserId: dbUser.id,
          startAt: linkedAppointment.startAt,
          timezoneAtBooking: linkedAppointment.timezoneAtBooking,
          patientServiceSessionId: linkedAppointment.patientServiceSessionId,
        });
        revalidatePath("/dashboard/finances");
      } catch (err) {
        console.error("[saveEvolution] efeitos financeiros da marcação:", err);
      }
      if (mayAutoConsumeSession && !data.deferAutomaticSessionConsumption) {
        try {
          sessionConsumption = await onEvolutionRecorded({
            professionalUserId: dbUser.id,
            patientId: patient.id,
            evolutionDate: evolution.date,
            evolutionId: evolution.id,
            appointmentId: appointmentIdTrimmed,
          });
        } catch (err) {
          console.error("[saveEvolution] consumo de sessão (financeiro):", err);
        }
      }
    } else if (mayAutoConsumeSession && !data.deferAutomaticSessionConsumption) {
      try {
        sessionConsumption = await onEvolutionRecorded({
          professionalUserId: dbUser.id,
          patientId: patient.id,
          evolutionDate: evolution.date,
          evolutionId: evolution.id,
          appointmentId: appointmentIdTrimmed,
        });
      } catch (err) {
        console.error("[saveEvolution] consumo de sessão (financeiro):", err);
      }
    }

    if (sessionConsumption?.consumed) {
      void maybeNotifyPackageNearEndFromConsumption({
        userId: dbUser.id,
        summary: {
          ...sessionConsumption,
          patientName: sessionConsumption.patientName ?? patient.name,
        },
      }).catch((err) =>
        console.error("[saveEvolution] aviso fim de plano:", err),
      );
    }

    if (data.professionalActions) {
      void notifyNewProfessionalActionsFromEvolution({
        userId: dbUser.id,
        evolutionId: evolution.id,
        patientId: patient.id,
        patientName: patient.name,
        professionalActions: data.professionalActions,
      }).catch((err) => console.error("[saveEvolution] push action items:", err));
    }

    return {
      success: true,
      evolutionId: evolution.id,
      patientId: patient.id,
      isNewPatient,
      sessionConsumption,
    };
  } catch (error) {
    console.error("❌ [saveEvolution] Erro ao salvar evolução:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Erro desconhecido ao salvar evolução",
    };
  }
}

/**
 * Fallback quando a Nova Evolução adiou o consumo automático e a venda do plano
 * falhou / não consumiu — tenta debitar FIFO (idempotente por evolutionId).
 */
export async function resumeDeferredEvolutionSessionConsumption(input: {
  patientId: string;
  evolutionId: string;
  attendanceDate?: string;
}): Promise<{
  success: boolean;
  consumed?: boolean;
  sessionConsumption?: EvolutionSessionConsumptionSummary;
  error?: string;
}> {
  try {
    const dbUserId = await getAuthenticatedDbUserId();
    if (!dbUserId) {
      return { success: false, error: "Não autenticado." };
    }

    const patientId = input.patientId.trim();
    const evolutionId = input.evolutionId.trim();
    if (!patientId || !evolutionId) {
      return { success: false, error: "Dados incompletos." };
    }

    const evolution = await prisma.evolution.findFirst({
      where: {
        id: evolutionId,
        patientId,
        patient: { userId: dbUserId },
      },
      select: { id: true, date: true, appointmentId: true },
    });
    if (!evolution) {
      return { success: false, error: "Evolução não encontrada." };
    }

    const planUser = await prisma.user.findUnique({
      where: { id: dbUserId },
      select: { plan: true, email: true, isInfluencer: true },
    });
    if (
      !planUser ||
      !canUseOfficeFinance(planUser.plan, planUser.email, planUser.isInfluencer)
    ) {
      return {
        success: false,
        error: "Baixa de sessão disponível no plano Premium ou superior.",
      };
    }

    const result = await onEvolutionRecorded({
      professionalUserId: dbUserId,
      patientId,
      evolutionDate: attendanceDateToSaoPauloNoon(input.attendanceDate) ?? evolution.date,
      evolutionId: evolution.id,
      appointmentId: evolution.appointmentId,
    });

    if (result.consumed) {
      void maybeNotifyPackageNearEndFromConsumption({
        userId: dbUserId,
        summary: result,
      }).catch((err) =>
        console.error("[resumeDeferredEvolutionSessionConsumption] aviso fim de plano:", err),
      );
    }

    revalidatePath("/dashboard/finances");
    revalidatePath(`/dashboard/patients/${patientId}`);
    return {
      success: true,
      consumed: result.consumed,
      sessionConsumption: result,
    };
  } catch (error) {
    console.error("[resumeDeferredEvolutionSessionConsumption]", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao retomar consumo de sessão.",
    };
  }
}

// Buscar estatísticas do usuário logado
export interface UserStats {
  totalPatients: number;
  totalEvolutions: number;
}

export interface GetUserStatsResult {
  success: boolean;
  stats?: UserStats;
  error?: string;
}

export async function getMyStats(): Promise<GetUserStatsResult> {
  try {
    const dbUser = await getAuthenticatedUser();

    if (!dbUser) {
      return {
        success: false,
        error: "Usuário não autenticado.",
      };
    }

    const statsScope = await getPatientAccessScope();
    const statsWhere = scopedPatientWhereOrEmpty(dbUser.id, statsScope);
    const [totalPatients, totalEvolutions] = await Promise.all([
      prisma.patient.count({
        where: statsWhere,
      }),
      prisma.evolution.count({
        where: {
          patient: statsWhere,
        },
      }),
    ]);

    return {
      success: true,
      stats: {
        totalPatients,
        totalEvolutions,
      },
    };
  } catch (error) {
    console.error("Erro ao buscar estatísticas:", error);
    return {
      success: false,
      error: "Erro ao carregar estatísticas.",
    };
  }
}

// ========== DELETAR PACIENTE ==========

export interface DeletePatientResult {
  success: boolean;
  error?: string;
}

// Deletar paciente e todas as suas evoluções
export async function deletePatient(patientId: string): Promise<DeletePatientResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !authUser?.email) {
      return { success: false, error: "Usuário não autenticado" };
    }

    // Buscar o usuário no banco
    const dbUser = await prisma.user.findUnique({
      where: { email: authUser.email },
      select: { id: true },
    });

    if (!dbUser) {
      return { success: false, error: "Usuário não encontrado" };
    }

    // Verificar se o paciente pertence ao usuário (escopo Intra User)
    const access = await assertPatientAccessible(patientId);
    if (!access.ok) {
      return {
        success: false,
        error: access.error ?? "Paciente não encontrado ou não pertence a você",
      };
    }

    // Deletar o paciente (as evoluções serão deletadas em cascata pelo onDelete: Cascade)
    await prisma.patient.delete({
      where: { id: patientId },
    });

    // Revalidar páginas
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/patients");

    return { success: true };
  } catch (error) {
    console.error("Erro ao deletar paciente:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao deletar paciente",
    };
  }
}

// ========== DELETAR EVOLUÇÃO ==========

export interface DeleteEvolutionResult {
  success: boolean;
  error?: string;
}

// Deletar uma evolução específica
export async function deleteEvolution(evolutionId: string): Promise<DeleteEvolutionResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !authUser?.email) {
      return { success: false, error: "Usuário não autenticado" };
    }

    // Buscar o usuário no banco
    const dbUser = await prisma.user.findUnique({
      where: { email: authUser.email },
      select: { id: true },
    });

    if (!dbUser) {
      return { success: false, error: "Usuário não encontrado" };
    }

    // Verificar se a evolução pertence a um paciente acessível ao perfil ativo
    const delScope = await getPatientAccessScope();
    if (!delScope || delScope.denied) {
      return { success: false, error: PROFILE_REQUIRED_ERROR };
    }
    const delScopeWhere = buildPatientScopeWhere(delScope);
    const evolution = await prisma.evolution.findFirst({
      where: {
        id: evolutionId,
        patient: delScopeWhere,
      },
      select: {
        id: true,
        patientId: true,
      },
    });

    if (!evolution) {
      return { success: false, error: "Evolução não encontrada ou não pertence a você" };
    }

    // Deletar a evolução
    await prisma.evolution.delete({
      where: { id: evolutionId },
    });

    // Revalidar páginas
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/patients");
    revalidatePath(`/dashboard/patients/${evolution.patientId}`);

    return { success: true };
  } catch (error) {
    console.error("Erro ao deletar evolução:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao deletar evolução",
    };
  }
}

const EVOLUTION_CONTENT_MAX = 60_000;
const EVOLUTION_FORM_FIELD_MAX = 4000;

const updateEvolutionClinicalTextSchema = z.object({
  evolutionId: z.string().uuid(),
  content: z.string().trim().min(1, "O texto da evolução não pode ficar vazio.").max(EVOLUTION_CONTENT_MAX),
  queixa: z.string().max(EVOLUTION_FORM_FIELD_MAX).optional(),
  diagnostico: z.string().max(EVOLUTION_FORM_FIELD_MAX).optional(),
  conduta: z.string().max(EVOLUTION_FORM_FIELD_MAX).optional(),
});

export type EditableEvolutionClinicalText = {
  id: string;
  content: string;
  queixa: string;
  diagnostico: string;
  conduta: string;
};

async function findEvolutionInActiveScope(evolutionId: string) {
  const scope = await getPatientAccessScope();
  if (!scope || scope.denied || !scope.activeIntraUser) return { scope: null, evolution: null };
  const evolution = await prisma.evolution.findFirst({
    where: {
      id: evolutionId,
      patient: { ...buildPatientScopeWhere(scope), ...clinicalPatientWhere },
    },
    select: { id: true, patientId: true, content: true, clinicalMeta: true },
  });
  return { scope, evolution };
}

/** Texto e campos do formulário de uma evolução salva, para correção manual na ficha. */
export async function getEvolutionClinicalTextForEdit(
  evolutionId: string,
): Promise<{ success: true; data: EditableEvolutionClinicalText } | { success: false; error: string }> {
  const dbUser = await getAuthenticatedUser();
  if (!dbUser) return { success: false, error: "Usuário não autenticado" };
  if (!z.string().uuid().safeParse(evolutionId).success) {
    return { success: false, error: "Evolução inválida." };
  }
  const { scope, evolution } = await findEvolutionInActiveScope(evolutionId);
  if (!scope) return { success: false, error: PROFILE_REQUIRED_ERROR };
  if (!evolution) return { success: false, error: "Evolução não encontrada ou não pertence a você" };

  const meta =
    evolution.clinicalMeta && typeof evolution.clinicalMeta === "object" && !Array.isArray(evolution.clinicalMeta)
      ? (evolution.clinicalMeta as Record<string, unknown>)
      : {};
  const metaText = (key: string) => (typeof meta[key] === "string" ? (meta[key] as string) : "");
  return {
    success: true,
    data: {
      id: evolution.id,
      content: evolution.content ?? "",
      queixa: metaText(EVOLUTION_FORM_META_KEYS.queixa),
      diagnostico: metaText(EVOLUTION_FORM_META_KEYS.diagnostico),
      conduta: metaText(EVOLUTION_FORM_META_KEYS.conduta),
    },
  };
}

/**
 * Correção manual de uma evolução salva (ex.: termo alucinado pela IA).
 * Invalida o PDF gravado para que o próximo download reflita o texto corrigido.
 */
export async function updateEvolutionClinicalText(
  input: unknown,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const dbUser = await getAuthenticatedUser();
    if (!dbUser) return { success: false, error: "Usuário não autenticado" };

    const parsed = updateEvolutionClinicalTextSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
    }

    const rl = await enforceRateLimit(`evolution-edit:${dbUser.id}`, PATIENT_PROFILE_UPDATE_RATE_LIMIT);
    if (!rl.allowed) return { success: false, error: `Tente em ${rl.resetIn}s.` };

    const { scope, evolution } = await findEvolutionInActiveScope(parsed.data.evolutionId);
    if (!scope?.activeIntraUser) return { success: false, error: PROFILE_REQUIRED_ERROR };
    if (!evolution) return { success: false, error: "Evolução não encontrada ou não pertence a você" };

    const content = sanitizeText(parsed.data.content).trim();
    if (!content) return { success: false, error: "O texto da evolução não pode ficar vazio." };

    const meta: Record<string, unknown> =
      evolution.clinicalMeta && typeof evolution.clinicalMeta === "object" && !Array.isArray(evolution.clinicalMeta)
        ? { ...(evolution.clinicalMeta as Record<string, unknown>) }
        : {};
    const applyField = (key: string, value: string | undefined) => {
      if (value === undefined) return;
      const clean = sanitizeText(value).trim().slice(0, EVOLUTION_FORM_FIELD_MAX);
      if (clean) meta[key] = clean;
      else delete meta[key];
    };
    applyField(EVOLUTION_FORM_META_KEYS.queixa, parsed.data.queixa);
    applyField(EVOLUTION_FORM_META_KEYS.diagnostico, parsed.data.diagnostico);
    applyField(EVOLUTION_FORM_META_KEYS.conduta, parsed.data.conduta);
    meta.manualEditedAt = new Date().toISOString();
    meta.manualEditedByIntraUserId = scope.activeIntraUser.id;

    await prisma.evolution.update({
      where: { id: evolution.id },
      data: {
        content,
        clinicalMeta: JSON.parse(JSON.stringify(meta)),
        pdfUrl: null,
      },
    });

    revalidatePath(`/dashboard/patients/${evolution.patientId}`);
    return { success: true };
  } catch (error) {
    console.error("[updateEvolutionClinicalText] Erro:", error);
    return { success: false, error: "Não foi possível salvar a correção da evolução." };
  }
}

const updatePatientClinicalReviewSchema = z.object({
  patientId: z.string().uuid(),
  summary: z.string().max(CLINICAL_SUMMARY_MAX_LEN),
  bullets: z.array(z.string().max(BULLET_MAX_LEN)).max(BULLETS_MAX_COUNT),
});

/**
 * Revisão manual do resumo clínico e dos tópicos do caso.
 * O que o profissional remove vai para `rejected` e não volta nas regenerações da IA.
 */
export async function updatePatientClinicalReview(
  input: unknown,
): Promise<
  | { success: true; summary: string; caseHighlights: string[] }
  | { success: false; error: string }
> {
  try {
    const dbUser = await getAuthenticatedUser();
    if (!dbUser) return { success: false, error: "Usuário não autenticado" };

    const parsed = updatePatientClinicalReviewSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
    }

    const rl = await enforceRateLimit(`patient-review:${dbUser.id}`, PATIENT_PROFILE_UPDATE_RATE_LIMIT);
    if (!rl.allowed) return { success: false, error: `Tente em ${rl.resetIn}s.` };

    const scope = await getPatientAccessScope();
    if (!scope || scope.denied || !scope.activeIntraUser) {
      return { success: false, error: PROFILE_REQUIRED_ERROR };
    }
    const patient = await prisma.patient.findFirst({
      where: {
        id: parsed.data.patientId,
        ...buildPatientScopeWhere(scope),
        ...clinicalPatientWhere,
      },
      select: { id: true, clinicalSummary: true },
    });
    if (!patient) return { success: false, error: "Paciente não encontrado ou acesso negado" };

    const prevJson = await fetchPatientClinicalCaseHighlightsJson(patient.id);
    const { stored, summary } = buildManualClinicalReview({
      previousBullets: parseClinicalCaseHighlightsStored(prevJson)?.bullets ?? [],
      previousSummary: patient.clinicalSummary ?? "",
      previousRejected: parseClinicalCaseHighlightsReviewMeta(prevJson).rejected,
      nextBullets: parsed.data.bullets,
      nextSummary: parsed.data.summary,
      editedAt: new Date(),
    });

    await prisma.patient.update({
      where: { id: patient.id },
      data: {
        clinicalSummary: summary || null,
        clinicalCaseHighlights: JSON.parse(JSON.stringify(stored)),
      },
    });

    revalidatePath(`/dashboard/patients/${patient.id}`);
    return { success: true, summary, caseHighlights: stored.bullets };
  } catch (error) {
    console.error("[updatePatientClinicalReview] Erro:", error);
    return { success: false, error: "Não foi possível salvar a revisão do resumo." };
  }
}

// ========== PRONTUÁRIO VIVO - RESUMO CLÍNICO ==========

export interface PatientMetrics {
  eva?: number[];           // Escala Visual Analógica de dor
  peso?: number[];          // Peso em kg
  amplitude?: number[];     // Amplitude de movimento
  humor?: string[];         // Para psicólogos
  adesao?: string[];        // Adesão ao tratamento
  [key: string]: unknown;   // Flexível para outras métricas
}

export interface UpdatePatientSummaryResult {
  success: boolean;
  summary?: string;
  metrics?: PatientMetrics;
  /** Bullets dos tópicos do caso (quando gerados com sucesso nesta execução). */
  caseHighlights?: string[];
  error?: string;
}

/**
 * Atualiza o resumo clínico do paciente usando IA
 * Chamado automaticamente após cada nova evolução
 */
export async function updatePatientSummary(patientId: string): Promise<UpdatePatientSummaryResult> {
  try {
    const dbUserId = await getAuthenticatedDbUserId();
    if (!dbUserId) {
      return { success: false, error: "Usuário não autenticado." };
    }

    // Buscar paciente com suas evoluções e dados do profissional (só do tenant logado)
    const patient = await prisma.patient.findFirst({
      where: { id: patientId, userId: dbUserId },
      select: {
        id: true,
        name: true,
        clinicalSummary: true,
        user: {
          select: { profession: true, name: true },
        },
        evolutions: {
          orderBy: { date: "desc" },
          take: 10,
          select: {
            id: true,
            date: true,
            content: true,
          },
        },
      },
    });

    if (!patient) {
      return { success: false, error: "Paciente não encontrado ou acesso negado" };
    }

    // Se não houver evoluções, não gerar resumo
    if (patient.evolutions.length === 0) {
      return { success: true, summary: undefined };
    }

    const prevHighlightsJson = await fetchPatientClinicalCaseHighlightsJson(patientId);
    const reviewMeta = parseClinicalCaseHighlightsReviewMeta(prevHighlightsJson);
    const prevBullets = parseClinicalCaseHighlightsStored(prevHighlightsJson)?.bullets ?? [];
    const professionalReviewBlock = reviewMeta.userEditedAt
      ? `
REVISÃO DO PROFISSIONAL (prevalece sobre a sua leitura):
O profissional corrigiu manualmente o resumo/tópicos em ${new Date(reviewMeta.userEditedAt).toLocaleDateString("pt-BR")}.
${patient.clinicalSummary ? `Resumo revisado: ${patient.clinicalSummary}\n` : ""}${prevBullets.length ? `Tópicos revisados: ${JSON.stringify(prevBullets)}\n` : ""}${reviewMeta.rejected.length ? `Itens REMOVIDOS pelo profissional — nunca reintroduza, nem reescritos: ${JSON.stringify(reviewMeta.rejected)}\n` : ""}Mantenha os tópicos revisados que continuam válidos e acrescente só o que vier de evoluções posteriores à revisão.
`
      : "";

    // Preparar contexto das evoluções
    const evolutionsContext = patient.evolutions.map((e, index) => {
      const dateStr = new Date(e.date).toLocaleDateString('pt-BR');
      const contentPreview = e.content ? clipAtSentenceBoundary(e.content, 1200) : "Sem conteúdo";
      return `[Evolução ${index + 1} - ${dateStr}]:\n${contentPreview}`;
    }).join("\n\n---\n\n");
    const groundingSource = patient.evolutions.map((e) => e.content ?? "").join("\n");
    /** Texto revisado pelo profissional também é fonte válida (ele pode reescrever com termos próprios). */
    const reviewSource = reviewMeta.userEditedAt
      ? [groundingSource, patient.clinicalSummary ?? "", ...prevBullets].join("\n")
      : groundingSource;

    const profession = patient.user?.profession || "Profissional de Saúde";
    const patientName = patient.name;
    const numEvolutions = patient.evolutions.length;

    // Calcular tempo de tratamento
    const firstEvolution = patient.evolutions[patient.evolutions.length - 1];
    const lastEvolution = patient.evolutions[0];
    const daysDiff = Math.ceil(
      (new Date(lastEvolution.date).getTime() - new Date(firstEvolution.date).getTime()) / (1000 * 60 * 60 * 24)
    );
    const treatmentDuration = daysDiff <= 0 ? "1 dia" : 
      daysDiff < 7 ? `${daysDiff} dias` :
      daysDiff < 30 ? `${Math.ceil(daysDiff / 7)} semanas` :
      `${Math.ceil(daysDiff / 30)} meses`;

    // Prompt para a IA
    const prompt = `Você organiza o prontuário de ${profession}. Resuma SOMENTE o que está escrito nas últimas ${numEvolutions} evoluções do paciente ${patientName}.

${CLINICAL_STRICT_EXTRACTION_POLICY}

HISTÓRICO DE EVOLUÇÕES:
${evolutionsContext}
${professionalReviewBlock}
TAREFA:
1. RESUMO CLÍNICO em um parágrafo (máximo 50 palavras) com:
   - Tempo de tratamento: ${treatmentDuration}
   - Diagnóstico principal, somente se escrito nas evoluções
   - Progresso recente, somente se as evoluções registram mudança (dor, amplitude, humor etc.)

2. TÓPICOS DO CASO: de 0 a 12 frases curtas, uma por fator clínico ESCRITO nas evoluções — diagnóstico/eixo principal, comorbidades ou riscos citados, intervenções e objetivos SOMENTE se o profissional os registrou, limitações funcionais relatadas, marcos temporais quando forem âncora do caso.
   - Não existe quantidade mínima: com uma única evolução inicial, normalmente bastam 2 a 4 tópicos.
   - Não deduza metodologia, conceito, linha de tratamento, objetivo ou prognóstico que não esteja escrito.
   - Siglas exatamente como escritas; não expanda sigla cujo significado não esteja nas evoluções.
   - Trecho marcado "[trecho seguinte omitido]" não deve ser completado.
   - NÃO inclua checklist de tarefas do profissional, NÃO use texto de orientação ao paciente (handout), NÃO repita o parágrafo do resumo como bullets.

3. Se houver números escritos nas evoluções (EVA/dor, peso, amplitude, percentuais), extraia em um JSON separado. Não estime valores.

FORMATO DE RESPOSTA (exatamente assim, três linhas/blocos nesta ordem):
RESUMO: [seu resumo aqui]
TOPICOS: ["tópico 1","tópico 2",...] ou TOPICOS: [] se não houver base
METRICAS: {"eva": [valores], "peso": [valores], ...} ou METRICAS: null se não houver dados numéricos

A linha TOPICOS deve ser um único array JSON válido em uma linha.`;

    // Chamar Gemini
    const getGeminiModel = await lazyGemini();
    const model = getGeminiModel({ generationConfig: clinicalGenerationConfig() });

    const result = await model.generateContent(prompt);
    const response = result.response.text();

    // Extrair resumo e métricas da resposta
    let summary = "";
    let metrics: PatientMetrics | undefined;

    // Extrair RESUMO (parar antes de TOPICOS ou METRICAS)
    const summaryMatch = response.match(/RESUMO:\s*([\s\S]+?)(?=TOPICOS:|METRICAS:|$)/);
    if (summaryMatch) {
      const sentences = dropRejectedItems(
        splitSummarySentences(summaryMatch[1].trim()),
        reviewMeta.rejected,
      );
      const { kept, dropped } = filterGroundedBullets(sentences, reviewSource);
      if (dropped.length) {
        console.warn(`[updatePatientSummary] ${dropped.length} frase(s) do resumo sem base nas evoluções descartada(s)`);
      }
      summary = kept.join(" ").trim();
    }

    let caseHighlights: string[] | undefined;
    let nextClinicalCaseHighlights = prevHighlightsJson;
    const topicosIdx = response.indexOf("TOPICOS:");
    if (topicosIdx >= 0) {
      const afterTopicos = response.slice(topicosIdx + "TOPICOS:".length);
      const metricasIdx = afterTopicos.indexOf("METRICAS:");
      const jsonSlice = (
        metricasIdx >= 0 ? afterTopicos.slice(0, metricasIdx) : afterTopicos
      ).trim();
      try {
        const parsedTopicos = JSON.parse(jsonSlice) as unknown;
        const asStrings = Array.isArray(parsedTopicos)
          ? parsedTopicos.map((x) => normalizeNotInformed(x)).filter(Boolean)
          : [];
        const { kept, dropped } = filterGroundedBullets(
          dropRejectedItems(asStrings, reviewMeta.rejected),
          reviewSource,
        );
        if (dropped.length) {
          console.warn(`[updatePatientSummary] ${dropped.length} tópico(s) sem base nas evoluções descartado(s)`);
        }
        const built = buildClinicalCaseHighlightsFromBullets(kept);
        const reviewFields = {
          ...(reviewMeta.userEditedAt ? { userEditedAt: reviewMeta.userEditedAt } : {}),
          ...(reviewMeta.rejected.length ? { rejected: reviewMeta.rejected } : {}),
        };
        if (built) {
          nextClinicalCaseHighlights = JSON.parse(JSON.stringify({ ...built, ...reviewFields }));
          caseHighlights = built.bullets;
        } else {
          nextClinicalCaseHighlights = reviewMeta.userEditedAt
            ? { v: 1, bullets: [], ...reviewFields }
            : null;
        }
      } catch {
        console.warn("[updatePatientSummary] Falha ao parsear TOPICOS — mantendo JSON anterior");
      }
    }

    // Extrair METRICAS
    const metricsMatch = response.match(/METRICAS:\s*(\{[\s\S]+?\})/);
    if (metricsMatch) {
      try {
        const parsed = JSON.parse(metricsMatch[1]);
        if (parsed && typeof parsed === 'object') {
          metrics = parsed as PatientMetrics;
        }
      } catch {
        // Métricas inválidas, ignorar
        console.warn("[updatePatientSummary] Falha ao parsear métricas");
      }
    }

    // Atualizar paciente no banco
    await prisma.patient.update({
      where: { id: patientId },
      data: {
        clinicalSummary: summary || null,
        clinicalCaseHighlights:
          nextClinicalCaseHighlights == null
            ? null
            : JSON.parse(JSON.stringify(nextClinicalCaseHighlights)),
        metrics: metrics ? JSON.parse(JSON.stringify(metrics)) : null,
        lastVisit: lastEvolution.date,
      }
    });

    console.log(`✅ [updatePatientSummary] Resumo atualizado para ${patientName}`);

    return {
      success: true,
      summary,
      metrics,
      ...(caseHighlights ? { caseHighlights } : {}),
    };
  } catch (error) {
    console.error("❌ [updatePatientSummary] Erro:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao atualizar resumo",
    };
  }
}

// ========== BUSCAR DETALHES COMPLETOS DO PACIENTE ==========

export interface PatientDetails {
  id: string;
  name: string;
  age: string | null;
  dateOfBirth: string | null;
  diagnosis: string | null;
  history: string | null;
  phone: string | null;
  fatherName: string | null;
  motherName: string | null;
  companionName: string | null;
  companionPhone: string | null;
  clinicalSummary: string | null;
  /** Tópicos principais do caso (bullets), persistidos com o resumo. */
  clinicalCaseHighlights: string[] | null;
  metrics: PatientMetrics | null;
  lastVisit: Date | null;
  createdAt: Date;
  evolutionCount: number;
  /** Ações sugeridas na evolução mais recente (checklist do profissional). */
  pendingProfessionalActionsCount: number;
  latestProfessionalActions?: ProfessionalActionsStored | null;
  /** Pontos-chave para o paciente (última evolução). */
  latestPatientHandout?: PatientHandoutStored | null;
  /** Medicamentos e suplementos da última evolução. */
  latestMedicationsAndSupplements?: MedicationsAndSupplementsStored | null;
  /** ID da evolução mais recente (para persistir estado dos action items). */
  latestEvolutionIdForArtifacts: string | null;
  /** Cor escolhida (#RRGGBB) ou null = automática na agenda. */
  agendaColor: string | null;
  /** Cor efetiva na agenda (salva ou hash automático). */
  resolvedAgendaColor: string;
  evolutions: {
    id: string;
    date: Date;
    content: string | null;
    pdfUrl: string | null;
    appointmentId: string | null;
    appointmentSlotLabel: string | null;
    source: "NATIVE" | "IMPORTED";
    importedFrom: string | null;
  }[];
}

export interface GetPatientDetailsResult {
  success: boolean;
  patient?: PatientDetails;
  error?: string;
}

export async function getPatientDetails(
  patientId: string,
  options?: { dbUserId?: string; activeIntraUser?: ActiveIntraUser | null },
): Promise<GetPatientDetailsResult> {
  try {
    const dbUser = options?.dbUserId
      ? await prisma.user.findUnique({
          where: { id: options.dbUserId },
          select: { id: true },
        })
      : await getAuthenticatedUser();

    if (!dbUser) {
      return { success: false, error: "Usuário não autenticado" };
    }

    // Web: cookie; API v1: activeIntraUser explícito. Sem perfil → fail-closed.
    const detailScope = options?.dbUserId
      ? {
          tenantId: dbUser.id,
          activeIntraUser: options.activeIntraUser ?? null,
          denied: !options.activeIntraUser,
        }
      : await getPatientAccessScope();
    if (!detailScope || detailScope.denied || !detailScope.activeIntraUser) {
      return { success: false, error: PROFILE_REQUIRED_ERROR };
    }
    const detailScopeWhere = buildPatientScopeWhere(detailScope);
    const patient = await prisma.patient.findFirst({
      where: {
        ...detailScopeWhere,
        id: patientId,
        ...clinicalPatientWhere,
      },
      select: {
        id: true,
        name: true,
        age: true,
        dateOfBirth: true,
        diagnosis: true,
        history: true,
        phone: true,
        fatherName: true,
        motherName: true,
        companionName: true,
        companionPhone: true,
        clinicalSummary: true,
        metrics: true,
        lastVisit: true,
        agendaColor: true,
        createdAt: true,
        evolutions: {
          orderBy: { date: "desc" },
          select: {
            id: true,
            date: true,
            content: true,
            pdfUrl: true,
            appointmentId: true,
            source: true,
            importedFrom: true,
            appointment: {
              select: {
                startAt: true,
                endAt: true,
                timezoneAtBooking: true,
              },
            },
          },
        },
        _count: {
          select: { evolutions: true },
        },
      },
    });

    if (!patient) {
      return { success: false, error: "Paciente não encontrado ou acesso negado" };
    }

    const highlightsJson = await fetchPatientClinicalCaseHighlightsJson(patientId);

    const latestEvo = await prisma.evolution.findFirst({
      where: { patientId },
      orderBy: { date: "desc" },
      select: {
        id: true,
        professionalActions: true,
        patientHandout: true,
        medicationsAndSupplements: true,
      },
    });

    const profParsed = professionalActionsStoredSchema.safeParse(latestEvo?.professionalActions);
    const handParsed = patientHandoutStoredSchema.safeParse(latestEvo?.patientHandout);
    const medsParsed = medicationsAndSupplementsStoredSchema.safeParse(
      latestEvo?.medicationsAndSupplements,
    );
    const latestProfessionalActions = profParsed.success ? profParsed.data : null;
    const latestPatientHandout = handParsed.success ? handParsed.data : null;
    const latestMedicationsAndSupplements = medsParsed.success ? medsParsed.data : null;
    const pendingProfessionalActionsCount = latestProfessionalActions
      ? latestProfessionalActions.items.filter((i) => i.completed !== true).length
      : 0;

    // Calcular lastVisit a partir das evoluções reais (ordenadas por date desc)
    const lastVisitFromEvolutions = patient.evolutions.length > 0
      ? patient.evolutions[0].date
      : patient.lastVisit;

    return {
      success: true,
      patient: {
        id: patient.id,
        name: patient.name,
        age: resolvePatientAgeLabel({
          dateOfBirth: patient.dateOfBirth,
          fallbackAge: patient.age,
        }),
        dateOfBirth: dateOfBirthToIso(patient.dateOfBirth),
        diagnosis: patient.diagnosis,
        history: patient.history,
        phone: patient.phone,
        fatherName: patient.fatherName,
        motherName: patient.motherName,
        companionName: patient.companionName,
        companionPhone: patient.companionPhone,
        clinicalSummary: patient.clinicalSummary,
        clinicalCaseHighlights:
          parseClinicalCaseHighlightsStored(highlightsJson)?.bullets ?? null,
        metrics: patient.metrics as PatientMetrics | null,
        lastVisit: lastVisitFromEvolutions,
        createdAt: patient.createdAt,
        evolutionCount: patient._count.evolutions,
        pendingProfessionalActionsCount,
        latestProfessionalActions,
        latestPatientHandout,
        latestMedicationsAndSupplements,
        latestEvolutionIdForArtifacts: latestEvo?.id ?? null,
        agendaColor: patient.agendaColor,
        resolvedAgendaColor: resolvePatientAgendaColor(patient.id, patient.agendaColor),
        evolutions: patient.evolutions.map((evo) => ({
          id: evo.id,
          date: evo.date,
          content: evo.content,
          pdfUrl: evo.pdfUrl,
          appointmentId: evo.appointmentId,
          source: evo.source === "IMPORTED" ? "IMPORTED" : "NATIVE",
          importedFrom: evo.importedFrom ?? null,
          appointmentSlotLabel: evo.appointment
            ? formatAppointmentSlotLabel(
                evo.appointment.startAt,
                evo.appointment.endAt,
                evo.appointment.timezoneAtBooking,
              )
            : null,
        })),
      }
    };
  } catch (error) {
    console.error("Erro ao buscar detalhes do paciente:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao carregar paciente",
    };
  }
}

export type PatientNewEvolutionPrefill = {
  patientId: string;
  name: string;
  age: string | null;
  dateOfBirth: string | null;
  diagnosis: string | null;
  phone: string | null;
  fatherName: string | null;
  motherName: string | null;
  companionName: string | null;
  companionPhone: string | null;
  /** Sessões PENDING em compras ativas — Nova Evolução baixa a próxima automaticamente. */
  pendingPlanSessionCount: number;
  activePlanServiceName: string | null;
};

export async function getPatientNewEvolutionPrefill(
  patientId: string,
): Promise<{ success: true; data: PatientNewEvolutionPrefill } | { success: false; error: string }> {
  const dbUser = await getAuthenticatedUser();
  if (!dbUser) {
    return { success: false, error: "Usuário não autenticado" };
  }

  const parsed = z.string().uuid().safeParse(patientId);
  if (!parsed.success) {
    return { success: false, error: "Paciente inválido." };
  }

  const access = await assertPatientAccessible(parsed.data);
  if (!access.ok || !access.scope) {
    return { success: false, error: access.error ?? "Paciente não encontrado." };
  }
  const patient = await prisma.patient.findFirst({
    where: {
      ...buildPatientScopeWhere(access.scope),
      id: parsed.data,
      ...clinicalPatientWhere,
    },
    select: {
      id: true,
      name: true,
      age: true,
      dateOfBirth: true,
      diagnosis: true,
      phone: true,
      fatherName: true,
      motherName: true,
      companionName: true,
      companionPhone: true,
    },
  });
  if (!patient) {
    return { success: false, error: "Paciente não encontrado." };
  }

  const activePlan = await prisma.patientServicePurchase.findFirst({
    where: {
      patientId: patient.id,
      professionalUserId: dbUser.id,
      sessions: { some: { status: PatientServiceSessionStatus.PENDING } },
    },
    orderBy: { purchasedAt: "asc" },
    select: {
      professionalService: { select: { name: true } },
      sessions: {
        where: { status: PatientServiceSessionStatus.PENDING },
        select: { id: true },
      },
    },
  });

  return {
    success: true,
    data: {
      patientId: patient.id,
      name: patient.name,
      age: resolvePatientAgeLabel({
        dateOfBirth: patient.dateOfBirth,
        fallbackAge: patient.age,
      }),
      dateOfBirth: dateOfBirthToIso(patient.dateOfBirth),
      diagnosis: patient.diagnosis,
      phone: patient.phone,
      fatherName: patient.fatherName,
      motherName: patient.motherName,
      companionName: patient.companionName,
      companionPhone: patient.companionPhone,
      pendingPlanSessionCount: activePlan?.sessions.length ?? 0,
      activePlanServiceName: activePlan?.professionalService.name ?? null,
    },
  };
}

export async function getLastEvolutionCopyDraft(
  patientId: string,
): Promise<{ success: true; data: EvolutionCopyDraft | null } | { success: false; error: string }> {
  const dbUser = await getAuthenticatedUser();
  if (!dbUser) {
    return { success: false, error: "Usuário não autenticado" };
  }

  const parsed = z.string().uuid().safeParse(patientId);
  if (!parsed.success) {
    return { success: false, error: "Paciente inválido." };
  }

  const copyScope = await getPatientAccessScope();
  if (!copyScope || copyScope.denied) {
    return { success: false, error: PROFILE_REQUIRED_ERROR };
  }
  const row = await prisma.evolution.findFirst({
    where: {
      patientId: parsed.data,
      patient: buildPatientScopeWhere(copyScope),
    },
    orderBy: { date: "desc" },
    select: {
      id: true,
      date: true,
      content: true,
      professionalActions: true,
      patientHandout: true,
      medicationsAndSupplements: true,
      clinicalMeta: true,
    },
  });

  if (!row) {
    return { success: true, data: null };
  }

  return { success: true, data: evolutionRowToCopyDraft(row) };
}

export type EvolutionPatientSearchHit = {
  id: string;
  name: string;
  ageLabel: string | null;
  diagnosis: string | null;
  lastEvolutionLabel: string | null;
};

const patientSearchSchema = z.object({
  query: z.string().trim().min(2).max(80),
});

/** Busca pacientes clínicos do profissional pelo nome (Nova Evolução). */
export async function searchPatientsForEvolution(
  query: string,
): Promise<
  | { success: true; patients: EvolutionPatientSearchHit[] }
  | { success: false; error: string }
> {
  const dbUser = await getAuthenticatedUser();
  if (!dbUser) {
    return { success: false, error: "Usuário não autenticado" };
  }

  const parsed = patientSearchSchema.safeParse({ query });
  if (!parsed.success) {
    return { success: false, error: "Digite pelo menos 2 letras do nome." };
  }

  const rl = await enforceRateLimit(
    `patient-search:${dbUser.id}`,
    API_V1_READ_RATE_LIMIT,
  );
  if (!rl.allowed) {
    return { success: false, error: `Tente em ${rl.resetIn}s.` };
  }

  const scope = await getPatientAccessScope();
  if (!scope || scope.denied) {
    return { success: false, error: PROFILE_REQUIRED_ERROR };
  }

  const patients = await prisma.patient.findMany({
    where: {
      ...buildPatientScopeWhere(scope),
      ...clinicalPatientWhere,
      name: { contains: parsed.data.query, mode: "insensitive" },
    },
    select: {
      id: true,
      name: true,
      age: true,
      dateOfBirth: true,
      diagnosis: true,
      evolutions: {
        orderBy: { date: "desc" },
        take: 1,
        select: { date: true },
      },
    },
    orderBy: { name: "asc" },
    take: 8,
  });

  return {
    success: true,
    patients: patients.map((patient) => {
      const last = patient.evolutions[0]?.date ?? null;
      const diagnosis = sanitizeText(patient.diagnosis ?? "").trim();
      return {
        id: patient.id,
        name: patient.name,
        ageLabel: resolvePatientAgeLabel({
          dateOfBirth: patient.dateOfBirth,
          fallbackAge: patient.age,
        }),
        diagnosis: diagnosis ? diagnosis.slice(0, 80) : null,
        lastEvolutionLabel: last
          ? last.toLocaleDateString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            })
          : null,
      };
    }),
  };
}

const updateAgendaColorSchema = z.object({
  patientId: z.string().uuid(),
  agendaColor: z.string().nullable(),
});

export async function updatePatientAgendaColor(
  patientId: string,
  agendaColor: string | null,
): Promise<{ success: boolean; error?: string; resolvedAgendaColor?: string }> {
  const dbUser = await getAuthenticatedUser();
  if (!dbUser) {
    return { success: false, error: "Usuário não autenticado" };
  }

  const parsed = updateAgendaColorSchema.safeParse({ patientId, agendaColor });
  if (!parsed.success) {
    return { success: false, error: "Dados inválidos." };
  }

  let normalized: string | null = null;
  if (parsed.data.agendaColor != null && parsed.data.agendaColor.trim() !== "") {
    normalized = normalizePatientAgendaColorInput(parsed.data.agendaColor);
    if (!normalized) {
      return { success: false, error: "Cor inválida. Escolha uma cor da paleta ou use automática." };
    }
  }

  const colorScope = await getPatientAccessScope();
  if (!colorScope || colorScope.denied) {
    return { success: false, error: PROFILE_REQUIRED_ERROR };
  }
  const updated = await prisma.patient.updateMany({
    where: {
      ...buildPatientScopeWhere(colorScope),
      id: parsed.data.patientId,
    },
    data: { agendaColor: normalized },
  });
  if (updated.count === 0) {
    return { success: false, error: "Paciente não encontrado." };
  }

  revalidatePath("/dashboard/agenda");
  revalidatePath(`/dashboard/patients/${parsed.data.patientId}`);

  return {
    success: true,
    resolvedAgendaColor: resolvePatientAgendaColor(parsed.data.patientId, normalized),
  };
}

export type UpdatePatientProfileResult = {
  success: boolean;
  error?: string;
  patient?: {
    name: string;
    age: string | null;
    dateOfBirth: string | null;
    diagnosis: string | null;
    history: string | null;
    phone: string | null;
    fatherName: string | null;
    motherName: string | null;
    companionName: string | null;
    companionPhone: string | null;
  };
};

/** Atualiza dados do cadastro clínico (nome, idade, diagnóstico, histórico). */
export async function updatePatientProfile(input: unknown): Promise<UpdatePatientProfileResult> {
  const dbUser = await getAuthenticatedUser();
  if (!dbUser) {
    return { success: false, error: "Usuário não autenticado" };
  }

  const rl = await enforceRateLimit(
    `patient-profile:${dbUser.id}`,
    PATIENT_PROFILE_UPDATE_RATE_LIMIT,
  );
  if (!rl.allowed) {
    return { success: false, error: `Tente novamente em ${rl.resetIn}s.` };
  }

  const parsed = updatePatientProfileSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Dados inválidos.",
    };
  }

  const profileScope = await getPatientAccessScope();
  if (!profileScope || profileScope.denied) {
    return { success: false, error: PROFILE_REQUIRED_ERROR };
  }

  const name = sanitizeText(parsed.data.name.trim());
  if (name.length < 2) {
    return { success: false, error: "Informe o nome do paciente." };
  }

  const current = await prisma.patient.findFirst({
    where: {
      ...buildPatientScopeWhere(profileScope),
      id: parsed.data.patientId,
      ...clinicalPatientWhere,
    },
    select: { dateOfBirth: true, age: true },
  });
  if (!current) {
    return { success: false, error: "Paciente não encontrado." };
  }

  const persisted = resolveBirthAndAgeForPersist({
    incomingBirthIso: parsed.data.dateOfBirth,
    existingBirth: current.dateOfBirth,
    incomingAge: emptyToNull(parsed.data.age),
    existingAge: current.age,
  });
  const age = persisted.age ? sanitizeText(persisted.age) : null;
  const diagnosis = emptyToNull(parsed.data.diagnosis)
    ? sanitizeText(parsed.data.diagnosis!.trim())
    : null;
  const history = emptyToNull(parsed.data.history)
    ? sanitizeText(parsed.data.history!.trim())
    : null;
  const contacts = persistOptionalContacts(
    contactsFromProfileForm({
      telefone: parsed.data.telefone,
      nomePai: parsed.data.nomePai,
      nomeMae: parsed.data.nomeMae,
      nomeAcompanhante: parsed.data.nomeAcompanhante,
      telefoneAcompanhante: parsed.data.telefoneAcompanhante,
    }),
  );

  const updated = await prisma.patient.updateMany({
    where: {
      ...buildPatientScopeWhere(profileScope),
      id: parsed.data.patientId,
      ...clinicalPatientWhere,
    },
    data: {
      name,
      age,
      dateOfBirth: persisted.dateOfBirth,
      diagnosis,
      history,
      ...contacts,
    },
  });
  if (updated.count === 0) {
    return { success: false, error: "Paciente não encontrado." };
  }

  revalidatePath("/dashboard/patients");
  revalidatePath(`/dashboard/patients/${parsed.data.patientId}`);
  revalidatePath("/dashboard/agenda");

  return {
    success: true,
    patient: {
      name,
      age,
      dateOfBirth: dateOfBirthToIso(persisted.dateOfBirth),
      diagnosis,
      history,
      phone: contacts.phone,
      fatherName: contacts.fatherName,
      motherName: contacts.motherName,
      companionName: contacts.companionName,
      companionPhone: contacts.companionPhone,
    },
  };
}

const toggleActionItemSchema = z.object({
  patientId: z.string().min(1, "patientId obrigatório"),
  itemIndex: z.number().int().min(0),
});

export async function toggleProfessionalActionItemCompleted(
  patientId: string,
  itemIndex: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const parsed = toggleActionItemSchema.safeParse({ patientId, itemIndex });
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues.map((i) => i.message).join("; "),
      };
    }

    const dbUser = await getAuthenticatedUser();
    if (!dbUser) {
      return { success: false, error: "Usuário não autenticado" };
    }

    const toggleScope = await getPatientAccessScope();
    if (!toggleScope || toggleScope.denied) {
      return { success: false, error: PROFILE_REQUIRED_ERROR };
    }
    const evo = await prisma.evolution.findFirst({
      where: {
        patientId: parsed.data.patientId,
        patient: buildPatientScopeWhere(toggleScope),
      },
      orderBy: { date: "desc" },
      select: { id: true, professionalActions: true },
    });

    if (!evo) {
      return { success: false, error: "Evolução não encontrada ou acesso negado" };
    }

    const profParsed = professionalActionsStoredSchema.safeParse(evo.professionalActions);
    if (!profParsed.success) {
      return { success: false, error: "Dados de ações do profissional inválidos" };
    }

    const items = profParsed.data.items;
    if (parsed.data.itemIndex >= items.length) {
      return { success: false, error: "Índice de ação inválido" };
    }

    const nextItems = items.map((item, i) =>
      i === parsed.data.itemIndex
        ? { ...item, completed: !item.completed }
        : item
    );

    const nextStored = professionalActionsStoredSchema.safeParse({
      ...profParsed.data,
      items: nextItems,
    });
    if (!nextStored.success) {
      return { success: false, error: "Não foi possível validar os dados atualizados" };
    }

    const asJson = JSON.parse(JSON.stringify(nextStored.data)) as object;

    await prisma.evolution.update({
      where: { id: evo.id },
      data: { professionalActions: asJson },
    });

    revalidatePath("/dashboard/patients");
    revalidatePath(`/dashboard/patients/${patientId}`);

    return { success: true };
  } catch (error) {
    console.error("toggleProfessionalActionItemCompleted:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao atualizar ação",
    };
  }
}

// ============ DETECÇÃO DE NOMES SIMILARES ============

export interface SimilarPatient {
  id: string;
  name: string;
  age: string | null;
  diagnosis: string | null;
  evolutionCount: number;
}

export interface FindSimilarPatientsResult {
  success: boolean;
  similarPatients?: SimilarPatient[];
  error?: string;
}

/**
 * Busca pacientes do usuário com nomes similares ao nome fornecido
 * Retorna matches exatos e por similaridade (typos), excluindo variações de gênero
 */
export async function findSimilarPatients(patientName: string): Promise<FindSimilarPatientsResult> {
  try {
    if (!patientName || patientName.trim().length < 2) {
      return { success: true, similarPatients: [] };
    }

    const dbUser = await getAuthenticatedUser();
    if (!dbUser) {
      return { success: false, error: "Usuário não autenticado" };
    }

    // Detecção de homônimos requer STARTER ou superior
    const userPlan = await prisma.user.findUnique({
      where: { id: dbUser.id },
      select: { plan: true, email: true, isInfluencer: true },
    });
    if (!userPlan || !isStarterOrAbove(userPlan.plan, userPlan.email, userPlan.isInfluencer)) {
      return { success: true, similarPatients: [] };
    }

    // Buscar pacientes no escopo Intra User (não todo o tenant).
    const similarScope = await getPatientAccessScope();
    const patients = await prisma.patient.findMany({
      where: {
        ...scopedPatientWhereOrEmpty(dbUser.id, similarScope),
        ...clinicalPatientWhere,
      },
      select: {
        id: true,
        name: true,
        age: true,
        diagnosis: true,
        _count: { select: { evolutions: true } },
      },
    });

    const similarPatients = matchSimilarPatients(
      patientName,
      patients.map((p) => ({
        id: p.id,
        name: p.name,
        age: p.age,
        diagnosis: p.diagnosis,
        evolutionCount: p._count.evolutions,
      })),
    );

    return { success: true, similarPatients };
  } catch (error) {
    console.error("Erro ao buscar pacientes similares:", error);
    return { success: false, error: "Erro ao verificar pacientes" };
  }
}

/**
 * Remove pacientes fantasma (com 0 evoluções) de todos os usuários.
 * Usado quando o ai.ts criava paciente prematuramente e o usuário vinculou a evolução a outro.
 */
export async function cleanupGhostPatients(): Promise<{
  success: boolean;
  deletedCount?: number;
  deletedNames?: string[];
  error?: string;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    if (authError || !authUser?.email) {
      return { success: false, error: "Usuário não autenticado" };
    }
    const dbUser = await prisma.user.findUnique({
      where: { email: authUser.email },
      select: { role: true },
    });
    if (!dbUser || !hasAdminRole(dbUser.role, authUser.email)) {
      return { success: false, error: "Acesso negado. Apenas administradores." };
    }

    const ghostPatients = await prisma.patient.findMany({
      // Apenas órfãos sem tenant — nunca apagar pacientes de contas ativas em lote.
      where: { userId: null, evolutions: { none: {} } },
      select: { id: true, name: true },
    });

    if (ghostPatients.length === 0) {
      return { success: true, deletedCount: 0, deletedNames: [] };
    }

    const deletedNames = ghostPatients.map((p) => p.name);
    await prisma.patient.deleteMany({
      where: { id: { in: ghostPatients.map((p) => p.id) } },
    });

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/patients");
    return { success: true, deletedCount: ghostPatients.length, deletedNames };
  } catch (error) {
    console.error("Erro ao limpar pacientes fantasma:", error);
    return { success: false, error: "Erro ao limpar pacientes fantasma" };
  }
}
