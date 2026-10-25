import { z } from "zod";
import {
  AppointmentCareSetting,
  AppointmentConfirmationStatus,
  AppointmentSource,
  AppointmentStatus,
  AppointmentVisitKind,
  FinancialTransactionKind,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { appointmentPatientDisplayName, clinicalPatientWhere } from "@/lib/patient-clinical-scope";
import { sanitizeText } from "@/lib/sanitize";
import { resolvePatientAgendaColor } from "@/lib/patient-agenda-color";
import { findAppointmentOverlap } from "@/lib/appointment-availability";
import { runAppointmentCompletionFinanceEffects } from "@/lib/finance/appointment-income";
import type { AppointmentCompletionEffects } from "@/lib/finance/appointment-income";
import { DEFAULT_SCHEDULE_TIMEZONE } from "@/lib/schedule-temporal-parse";
import { scheduleGoogleCalendarPush } from "@/lib/google-calendar-push";
import { scheduleMarketplaceSlotSync } from "@/lib/marketplace/marketplace-sync";
import {
  MARKETPLACE_SLOT_TAKEN_BY_PATIENT,
  RESOURCE_AT_CAPACITY,
  blockYieldSlotsForNativeAppointment,
  findMarketplaceBookedOverlap,
  withAgendaYieldTransaction,
} from "@/lib/marketplace/native-agenda-lock";
import { findResourceCapacityOverlap } from "@/lib/appointment-availability";
import { unlinkGoogleCalendarEventForAppointment } from "@/lib/google-calendar-sync";
import { unlinkPatientGoogleCalendarEvent } from "@/lib/google-calendar-patient-sync";
import { logger } from "@/lib/logger";
import { resolveTreatmentPlanSessionForAppointment } from "@/lib/appointment-plan-session";
import { resolveConfirmationStatusFromGuess } from "@/lib/appointment-confirmation";
import {
  appointmentCareSettingSchema,
  appointmentConfirmationStatusSchema,
  appointmentMetaFieldsSchema,
  appointmentVisitKindSchema,
} from "@/lib/appointment-fields-schema";
import {
  formatSuggestedSlotsMessage,
  suggestAlternativeSlots,
  type SuggestedSlot,
} from "@/lib/appointment-suggested-slots";
import {
  buildPatientScopeWhere,
  type ActiveIntraUser,
} from "@/lib/intra-user/patient-scope";
import { assertPatientAccessibleWithScope } from "@/lib/intra-user/patient-access";
import { assertServiceSpaceOwned } from "@/app/actions/service-spaces";
import {
  parseServiceSpaceViewParam,
  serviceSpaceWhere,
} from "@/lib/service-spaces/access";
import { appointmentFreesSlot } from "@/lib/appointment-status";
import {
  assertSlotsAvailable,
  buildRecurrenceSlots,
  createAppointmentSeriesRows,
  createRecurrenceFieldsSchema,
} from "@/server/services/appointment-recurrence";

const appointmentSourceSchema = z.enum(["MANUAL", "VOICE", "OCR", "GOOGLE_SYNC"]);
const appointmentStatusSchema = z.enum(["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"]);

export const createAppointmentInputSchema = z
  .object({
    patientId: z.string().min(1).optional(),
    newPatientName: z.string().min(1).max(200).optional(),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    timezoneAtBooking: z.string().min(1).max(64).optional(),
    source: appointmentSourceSchema.optional(),
    title: z.string().max(500).optional(),
    visitKind: appointmentVisitKindSchema.optional(),
    careSetting: appointmentCareSettingSchema.optional(),
    priceCents: appointmentMetaFieldsSchema.shape.priceCents,
    notes: appointmentMetaFieldsSchema.shape.notes,
    patientServiceSessionId: appointmentMetaFieldsSchema.shape.patientServiceSessionId,
    professionalServiceId: appointmentMetaFieldsSchema.shape.professionalServiceId,
    serviceSpaceId: appointmentMetaFieldsSchema.shape.serviceSpaceId,
    confirmationStatus: appointmentConfirmationStatusSchema.optional(),
    recurrenceSessionCount: createRecurrenceFieldsSchema.shape.recurrenceSessionCount,
    recurrenceWeekdays: createRecurrenceFieldsSchema.shape.recurrenceWeekdays,
  })
  .refine((d) => d.endAt.getTime() > d.startAt.getTime(), {
    message: "endAt deve ser posterior a startAt.",
    path: ["endAt"],
  })
  .refine(
    (d) => {
      const hasId = Boolean(d.patientId?.trim());
      const hasName = Boolean(d.newPatientName?.trim());
      return hasId !== hasName;
    },
    {
      message: "Selecione um paciente existente ou informe o nome de um novo paciente.",
      path: ["patientId"],
    },
  )
  .refine(
    (d) => {
      const hasCount = d.recurrenceSessionCount != null;
      const hasDays = d.recurrenceWeekdays != null && d.recurrenceWeekdays.length > 0;
      return hasCount === hasDays;
    },
    {
      message: "Para repetir, informe quantidade de sessões e dias da semana.",
      path: ["recurrenceWeekdays"],
    },
  );

export const updateAppointmentInputSchema = z
  .object({
    appointmentId: z.string().min(1),
    patientId: z.string().min(1).optional(),
    newPatientName: z.string().min(2).max(200).optional(),
    startAt: z.coerce.date().optional(),
    endAt: z.coerce.date().optional(),
    status: appointmentStatusSchema.optional(),
    title: z.string().max(500).nullable().optional(),
    timezoneAtBooking: z.string().min(1).max(64).optional(),
    visitKind: appointmentVisitKindSchema.optional(),
    careSetting: appointmentCareSettingSchema.optional(),
    priceCents: appointmentMetaFieldsSchema.shape.priceCents,
    notes: appointmentMetaFieldsSchema.shape.notes,
    patientServiceSessionId: appointmentMetaFieldsSchema.shape.patientServiceSessionId,
    professionalServiceId: appointmentMetaFieldsSchema.shape.professionalServiceId,
    serviceSpaceId: appointmentMetaFieldsSchema.shape.serviceSpaceId,
    confirmationStatus: appointmentConfirmationStatusSchema.optional(),
    noShowReason: z.string().max(2000).optional(),
  })
  .refine(
    (d) => {
      if (d.startAt && d.endAt) {
        return d.endAt.getTime() > d.startAt.getTime();
      }
      return true;
    },
    { message: "endAt deve ser posterior a startAt.", path: ["endAt"] },
  )
  .refine(
    (d) =>
      d.status !== "NO_SHOW" ||
      (typeof d.noShowReason === "string" && d.noShowReason.trim().length >= 3),
    {
      message: "Informe a justificativa da falta (mínimo 3 caracteres).",
      path: ["noShowReason"],
    },
  );

export const cancelAppointmentInputSchema = z.object({
  appointmentId: z.string().min(1),
});

export const listAppointmentsRangeSchema = z
  .object({
    start: z.coerce.date(),
    end: z.coerce.date(),
    /** Visão por Espaço de Serviços (Consultório/Clínica). Omitido = Todos. */
    serviceSpaceId: z.string().min(1).optional(),
  })
  .refine((d) => d.end.getTime() > d.start.getTime(), {
    message: "Intervalo inválido.",
    path: ["end"],
  });

export type AppointmentServiceResult<T = unknown> =
  | { success: true; data?: T; createdPatient?: boolean }
  | { success: false; error: string; suggestedSlots?: SuggestedSlot[] };

export type AppointmentListItem = {
  id: string;
  patientId: string;
  patientName: string;
  /** Cor efetiva na barra lateral do card (hex). */
  patientAgendaColor: string;
  /** Intra User (profissional) que realizará o atendimento (agenda de equipe). */
  intraUserId: string | null;
  /** Nome do profissional que atende (clínica). */
  professionalName: string | null;
  /** Cor HEX do profissional que atende — prioridade na agenda de equipe. */
  professionalColor: string | null;
  startAt: Date;
  endAt: Date;
  status: AppointmentStatus;
  title: string | null;
  timezoneAtBooking: string;
  source: AppointmentSource;
  visitKind: AppointmentVisitKind;
  careSetting: AppointmentCareSetting;
  priceCents: number | null;
  notes: string | null;
  patientServiceSessionId: string | null;
  professionalServiceId: string | null;
  serviceName: string | null;
  serviceSpaceId: string | null;
  serviceSpaceName: string | null;
  serviceSpaceColor: string | null;
  hasFinanceIncome: boolean;
  confirmationStatus: AppointmentConfirmationStatus;
  evolutionId: string | null;
  hasEvolution: boolean;
  noShowReason: string | null;
  recurrenceSeriesId: string | null;
};

type ResolvedAppointmentMeta = {
  visitKind: AppointmentVisitKind;
  careSetting: AppointmentCareSetting;
  priceCents: number | null;
  notes: string | null;
  patientServiceSessionId: string | null;
  professionalServiceId: string | null;
  serviceSpaceId: string | null;
};

async function assertProfessionalServiceOwnedByUser(
  professionalServiceId: string,
  professionalUserId: string,
): Promise<{ ok: true; defaultPriceCents: number } | { ok: false; error: string }> {
  const service = await prisma.professionalService.findFirst({
    where: { id: professionalServiceId, userId: professionalUserId, active: true },
    select: { id: true, defaultPriceCents: true },
  });
  if (!service) {
    return { ok: false, error: "Serviço não encontrado no catálogo ou inativo." };
  }
  return { ok: true, defaultPriceCents: service.defaultPriceCents };
}

async function resolveAppointmentMetaForWrite(params: {
  professionalUserId: string;
  patientId: string;
  visitKind?: AppointmentVisitKind;
  careSetting?: AppointmentCareSetting;
  priceCents?: number | null;
  notes?: string | null;
  patientServiceSessionId?: string | null;
  professionalServiceId?: string | null;
  serviceSpaceId?: string | null;
  currentAppointmentId?: string;
  existing?: Partial<ResolvedAppointmentMeta>;
}): Promise<{ ok: true; data: ResolvedAppointmentMeta } | { ok: false; error: string }> {
  const visitKind = params.visitKind ?? params.existing?.visitKind ?? AppointmentVisitKind.UNIQUE_CONSULTATION;
  const careSetting =
    params.careSetting ?? params.existing?.careSetting ?? AppointmentCareSetting.IN_PERSON_CLINIC;

  const planRes = await resolveTreatmentPlanSessionForAppointment({
    professionalUserId: params.professionalUserId,
    patientId: params.patientId,
    visitKind,
    explicitSessionId:
      visitKind === AppointmentVisitKind.TREATMENT_PLAN
        ? (params.patientServiceSessionId ?? params.existing?.patientServiceSessionId)
        : null,
    currentAppointmentId: params.currentAppointmentId,
  });
  if (!planRes.ok) {
    return { ok: false, error: planRes.error };
  }

  const notesRaw =
    params.notes !== undefined ? params.notes : (params.existing?.notes ?? null);
  const notes = notesRaw === null || notesRaw === undefined ? null : sanitizeText(notesRaw);

  let professionalServiceId: string | null;
  if (visitKind === AppointmentVisitKind.TREATMENT_PLAN && planRes.sessionId) {
    professionalServiceId = planRes.professionalServiceId;
  } else if (params.professionalServiceId !== undefined) {
    const raw = params.professionalServiceId?.trim();
    if (!raw) {
      professionalServiceId = null;
    } else {
      const svc = await assertProfessionalServiceOwnedByUser(raw, params.professionalUserId);
      if (!svc.ok) {
        return { ok: false, error: svc.error };
      }
      professionalServiceId = raw;
    }
  } else {
    professionalServiceId = params.existing?.professionalServiceId ?? null;
  }

  let priceCents: number | null;
  if (params.priceCents !== undefined) {
    priceCents = params.priceCents;
  } else if (visitKind === AppointmentVisitKind.TREATMENT_PLAN && planRes.sessionId) {
    priceCents = planRes.priceCents;
  } else if (professionalServiceId) {
    const svc = await assertProfessionalServiceOwnedByUser(
      professionalServiceId,
      params.professionalUserId,
    );
    if (!svc.ok) {
      return { ok: false, error: svc.error };
    }
    priceCents =
      svc.defaultPriceCents > 0
        ? svc.defaultPriceCents
        : (params.existing?.priceCents ?? null);
  } else {
    priceCents = params.existing?.priceCents ?? null;
  }

  let serviceSpaceId: string | null;
  if (params.serviceSpaceId !== undefined) {
    const raw = params.serviceSpaceId?.trim();
    if (!raw) {
      // null/"" = opção «Geral» explícita (não herdar do catálogo).
      serviceSpaceId = null;
    } else {
      const allowInactive = params.existing?.serviceSpaceId === raw;
      const spaceCheck = await assertServiceSpaceOwned(raw, params.professionalUserId, {
        allowInactive,
      });
      if (!spaceCheck.ok) return { ok: false, error: spaceCheck.error };
      serviceSpaceId = spaceCheck.spaceId;
    }
  } else {
    // Campo omitido: herdar serviço → marcação existente.
    let inherited: string | null = null;
    if (professionalServiceId) {
      const svcSpace = await prisma.professionalService.findFirst({
        where: { id: professionalServiceId, userId: params.professionalUserId },
        select: { serviceSpaceId: true },
      });
      inherited = svcSpace?.serviceSpaceId ?? null;
    }
    serviceSpaceId = inherited ?? params.existing?.serviceSpaceId ?? null;
  }

  // Plano de tratamento: a compra manda no espaço (alinha agenda ↔ financeiro).
  if (visitKind === AppointmentVisitKind.TREATMENT_PLAN && planRes.sessionId) {
    const sess = await prisma.patientServiceSession.findFirst({
      where: { id: planRes.sessionId },
      select: { purchase: { select: { serviceSpaceId: true } } },
    });
    const purchaseSpace = sess?.purchase.serviceSpaceId ?? null;
    if (purchaseSpace) {
      if (serviceSpaceId && serviceSpaceId !== purchaseSpace) {
        return {
          ok: false,
          error: "O espaço da marcação deve coincidir com o da compra do plano.",
        };
      }
      serviceSpaceId = purchaseSpace;
    }
  }

  // Serviço exclusivo de outra sala não pode ficar associado ao espaço escolhido.
  if (professionalServiceId && serviceSpaceId) {
    const svcSpace = await prisma.professionalService.findFirst({
      where: { id: professionalServiceId, userId: params.professionalUserId },
      select: { serviceSpaceId: true },
    });
    if (
      svcSpace?.serviceSpaceId &&
      svcSpace.serviceSpaceId !== serviceSpaceId
    ) {
      return {
        ok: false,
        error: "O serviço selecionado não pertence a este Espaço de Serviços.",
      };
    }
  }

  return {
    ok: true,
    data: {
      visitKind,
      careSetting,
      priceCents,
      notes,
      patientServiceSessionId:
        visitKind === AppointmentVisitKind.TREATMENT_PLAN && planRes.sessionId
          ? planRes.sessionId
          : null,
      professionalServiceId,
      serviceSpaceId,
    },
  };
}

async function assertPatientOwnedByProfessional(
  patientId: string,
  professionalUserId: string,
  activeIntraUser: ActiveIntraUser | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return assertPatientAccessibleWithScope(patientId, professionalUserId, activeIntraUser);
}

export type AppointmentIntraOptions = {
  attendingIntraUserId?: string | null;
  /** Perfil ativo para segregação (obrigatório em planos de equipe com 2+ perfis). */
  activeIntraUser?: ActiveIntraUser | null;
};

export async function createAppointmentForUser(
  userId: string,
  input: unknown,
  options?: AppointmentIntraOptions,
): Promise<
  AppointmentServiceResult<{
    id: string;
    seriesId?: string;
    createdCount?: number;
    createdIds?: string[];
  }>
> {
  const parsed = createAppointmentInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join(" ") };
  }

  const activeIntraUser = options?.activeIntraUser ?? null;
  const patientScopeWhere = buildPatientScopeWhere({
    tenantId: userId,
    activeIntraUser,
  });

  // Profissional que atende (agenda de equipe). Valida que pertence ao Tenant;
  // o acesso ao paciente é validado depois de resolver o patientId.
  let attendingIntraUser: ActiveIntraUser | null = null;
  if (options?.attendingIntraUserId) {
    const intra = await prisma.intraUser.findFirst({
      where: { id: options.attendingIntraUserId, userId },
      select: {
        id: true,
        name: true,
        color: true,
        role: true,
        isOwner: true,
        pinHash: true,
        canManagePatientServices: true,
      },
    });
    if (!intra) {
      return {
        success: false,
        error: "Profissional da equipe inválido ou não pertence a esta conta.",
      };
    }
    attendingIntraUser = {
      id: intra.id,
      name: intra.name,
      color: intra.color,
      role: intra.role,
      isOwner: intra.isOwner,
      hasPin: intra.role === "ADMIN" && Boolean(intra.pinHash),
      canManagePatientServices:
        intra.role === "ADMIN" ? true : intra.canManagePatientServices !== false,
    };
  } else if (activeIntraUser) {
    attendingIntraUser = activeIntraUser;
  }
  const attendingIntraUserId = attendingIntraUser?.id ?? null;

  const {
    patientId,
    newPatientName,
    startAt,
    endAt,
    timezoneAtBooking,
    source,
    title,
    visitKind,
    careSetting,
    priceCents,
    notes,
    patientServiceSessionId,
    professionalServiceId,
    serviceSpaceId,
    confirmationStatus,
    recurrenceSessionCount,
    recurrenceWeekdays,
  } = parsed.data;
  const tz = timezoneAtBooking ?? DEFAULT_SCHEDULE_TIMEZONE;
  let createdPatient = false;

  let resolvedPatientId: string;

  if (newPatientName?.trim()) {
    const name = sanitizeText(newPatientName.trim());
    if (name.length < 2) {
      return { success: false, error: "Nome do paciente deve ter pelo menos 2 caracteres." };
    }
    // Preferir ficha clínica existente com o mesmo nome (escopo Intra User).
    const clinical = await prisma.patient.findFirst({
      where: {
        ...patientScopeWhere,
        agendaOnly: false,
        name: { equals: name, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (clinical) {
      resolvedPatientId = clinical.id;
    } else {
      // Compromisso / nome livre: placeholder agendaOnly — NÃO entra na lista de pacientes.
      // Escopo Intra User: MEMBER só reutiliza placeholder próprio ou compartilhado.
      const existingAgenda = await prisma.patient.findFirst({
        where: {
          ...patientScopeWhere,
          agendaOnly: true,
          name: { equals: name, mode: "insensitive" },
        },
        select: { id: true, ownerId: true, isShared: true },
      });
      if (existingAgenda) {
        // Defesa em profundidade: escopo Prisma já filtra, mas revalida acesso
        // do perfil ativo (e depois do attending) antes de reutilizar.
        const reuseAccess = await assertPatientAccessibleWithScope(
          existingAgenda.id,
          userId,
          activeIntraUser,
        );
        if (!reuseAccess.ok) {
          return {
            success: false,
            error: "Paciente de agenda não encontrado ou sem permissão.",
          };
        }
        resolvedPatientId = existingAgenda.id;
      } else {
        // Todo paciente novo (incl. placeholder) precisa de dono Intra User explícito.
        if (!activeIntraUser) {
          return {
            success: false,
            error: "Selecione o perfil profissional para continuar.",
          };
        }
        const created = await prisma.patient.create({
          data: {
            name,
            userId,
            agendaOnly: true,
            ownerId: activeIntraUser.id,
            isShared: false,
          },
          select: { id: true },
        });
        resolvedPatientId = created.id;
        createdPatient = true;
      }
    }
  } else {
    resolvedPatientId = patientId!;
    const own = await assertPatientOwnedByProfessional(
      resolvedPatientId,
      userId,
      activeIntraUser,
    );
    if (!own.ok) {
      return { success: false, error: own.error };
    }
    const clinical = await prisma.patient.findFirst({
      where: { ...patientScopeWhere, id: resolvedPatientId, ...clinicalPatientWhere },
      select: { id: true },
    });
    if (!clinical) {
      return {
        success: false,
        error: "Selecione um paciente clínico da lista, ou use um nome livre (compromisso).",
      };
    }
  }

  // Segregação: quem atende precisa poder acessar o paciente (owner/shared/ADMIN).
  if (attendingIntraUser) {
    const attendingAccess = await assertPatientAccessibleWithScope(
      resolvedPatientId,
      userId,
      attendingIntraUser,
    );
    if (!attendingAccess.ok) {
      return {
        success: false,
        error:
          "O profissional selecionado para atender não tem permissão sobre este paciente.",
      };
    }
  }

  const overlap = await findAppointmentOverlap(userId, startAt, endAt, {
    intraUserId: attendingIntraUserId,
  });
  if (overlap.overlapping) {
    const durationMin = Math.round((endAt.getTime() - startAt.getTime()) / 60_000);
    const suggestions = await suggestAlternativeSlots({
      professionalUserId: userId,
      preferredStartUtc: startAt,
      durationMinutes: Math.max(15, durationMin),
      timezone: tz,
    });
    return {
      success: false,
      error:
        "Horário indisponível (conflito com outra marcação)." +
        formatSuggestedSlotsMessage(suggestions),
      suggestedSlots: suggestions,
    };
  }

  if (serviceSpaceId) {
    const resourceBusy = await findResourceCapacityOverlap(
      userId,
      serviceSpaceId,
      startAt,
      endAt,
    );
    if (resourceBusy.overlapping) {
      return { success: false, error: RESOURCE_AT_CAPACITY };
    }
  }

  const metaRes = await resolveAppointmentMetaForWrite({
    professionalUserId: userId,
    patientId: resolvedPatientId,
    visitKind,
    careSetting,
    priceCents,
    notes,
    patientServiceSessionId,
    professionalServiceId,
    serviceSpaceId,
  });
  if (!metaRes.ok) {
    return { success: false, error: metaRes.error };
  }

  try {
    const wantsSeries =
      recurrenceSessionCount != null &&
      recurrenceWeekdays != null &&
      recurrenceWeekdays.length > 0 &&
      recurrenceSessionCount >= 2;

    if (wantsSeries) {
      const durationMinutes = Math.max(
        15,
        Math.round((endAt.getTime() - startAt.getTime()) / 60_000),
      );
      let slots;
      try {
        slots = buildRecurrenceSlots({
          firstStartAt: startAt,
          durationMinutes,
          sessionCount: recurrenceSessionCount,
          weekdays: recurrenceWeekdays,
          timezone: tz,
        });
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Não foi possível montar a série.",
        };
      }

      const blocked = await assertSlotsAvailable({
        userId,
        slots,
        durationMinutes,
        timezone: tz,
        intraUserId: attendingIntraUserId,
        serviceSpaceId: metaRes.data.serviceSpaceId,
      });
      if (blocked) return blocked;

      const { seriesId, ids } = await createAppointmentSeriesRows({
        userId,
        slots,
        meta: {
          professionalUserId: userId,
          intraUserId: attendingIntraUserId,
          patientId: resolvedPatientId,
          timezoneAtBooking: tz,
          source: source ?? AppointmentSource.MANUAL,
          title: title ? sanitizeText(title) : null,
          visitKind: metaRes.data.visitKind,
          careSetting: metaRes.data.careSetting,
          priceCents: metaRes.data.priceCents,
          notes: metaRes.data.notes,
          professionalServiceId: metaRes.data.professionalServiceId,
          serviceSpaceId: metaRes.data.serviceSpaceId,
          patientServiceSessionId: metaRes.data.patientServiceSessionId,
          confirmationStatus: resolveConfirmationStatusFromGuess(confirmationStatus),
        },
      });

      for (const id of ids) {
        scheduleGoogleCalendarPush(userId, id);
      }

      return {
        success: true,
        data: {
          id: ids[0]!,
          seriesId,
          createdCount: ids.length,
          createdIds: ids,
        },
        createdPatient,
      };
    }

    const row = await withAgendaYieldTransaction(async (tx) => {
      const market = await findMarketplaceBookedOverlap(tx, userId, startAt, endAt);
      if (market.overlapping) {
        throw new Error(MARKETPLACE_SLOT_TAKEN_BY_PATIENT);
      }

      const created = await tx.appointment.create({
        data: {
          professionalUserId: userId,
          intraUserId: attendingIntraUserId,
          patientId: resolvedPatientId,
          startAt,
          endAt,
          timezoneAtBooking: tz,
          source: source ?? AppointmentSource.MANUAL,
          title: title ? sanitizeText(title) : null,
          visitKind: metaRes.data.visitKind,
          careSetting: metaRes.data.careSetting,
          priceCents: metaRes.data.priceCents,
          notes: metaRes.data.notes,
          patientServiceSessionId: metaRes.data.patientServiceSessionId,
          professionalServiceId: metaRes.data.professionalServiceId,
          serviceSpaceId: metaRes.data.serviceSpaceId,
          confirmationStatus: resolveConfirmationStatusFromGuess(confirmationStatus),
        },
        select: { id: true },
      });

      await blockYieldSlotsForNativeAppointment(tx, {
        professionalUserId: userId,
        appointmentId: created.id,
        startAt,
        endAt,
        serviceSpaceId: metaRes.data.serviceSpaceId,
        priceCents: metaRes.data.priceCents,
      });

      return created;
    });

    scheduleGoogleCalendarPush(userId, row.id);
    return { success: true, data: { id: row.id }, createdPatient };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === MARKETPLACE_SLOT_TAKEN_BY_PATIENT) {
      return { success: false, error: MARKETPLACE_SLOT_TAKEN_BY_PATIENT };
    }
    throw error;
  }
}

export async function updateAppointmentForUser(
  userId: string,
  input: unknown,
  options?: AppointmentIntraOptions,
): Promise<
  AppointmentServiceResult<{
    id: string;
    becameCompleted?: boolean;
    patientId?: string;
    completionEffects?: AppointmentCompletionEffects;
  }>
> {
  const parsed = updateAppointmentInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join(" ") };
  }

  const activeIntraUser = options?.activeIntraUser ?? null;
  const patientScopeWhere = buildPatientScopeWhere({
    tenantId: userId,
    activeIntraUser,
  });

  const {
    appointmentId,
    patientId,
    newPatientName,
    startAt,
    endAt,
    status,
    title,
    timezoneAtBooking,
    visitKind,
    careSetting,
    priceCents,
    notes,
    patientServiceSessionId,
    professionalServiceId,
    serviceSpaceId,
    confirmationStatus,
    noShowReason,
  } = parsed.data;

  const existing = await prisma.appointment.findFirst({
    where: { id: appointmentId, professionalUserId: userId },
  });
  if (!existing) {
    return { success: false, error: "Marcação não encontrada." };
  }

  if (
    appointmentFreesSlot(existing.status) &&
    (startAt || endAt || patientId)
  ) {
    return {
      success: false,
      error:
        existing.status === AppointmentStatus.NO_SHOW
          ? "Marcação marcada como falta não pode ser reagendada. Crie uma nova."
          : "Marcação cancelada não pode ser alterada.",
    };
  }

  // Sempre valida o paciente atual (ou o novo) no escopo Intra User —
  // MEMBER não pode alterar status/título de marcação de paciente fora do escopo.
  const nextPatientId = patientId ?? existing.patientId;
  const ownCurrent = await assertPatientOwnedByProfessional(
    nextPatientId,
    userId,
    activeIntraUser,
  );
  if (!ownCurrent.ok) {
    return { success: false, error: ownCurrent.error };
  }

  /** Nome após "Corrigir nome" — também atualiza `title` (GOOGLE_SYNC exibe o título). */
  let renamedDisplayName: string | null = null;
  if (newPatientName?.trim()) {
    const name = sanitizeText(newPatientName.trim());
    if (name.length < 2) {
      return { success: false, error: "Nome do paciente deve ter pelo menos 2 caracteres." };
    }
    const current = await prisma.patient.findFirst({
      where: { ...patientScopeWhere, id: nextPatientId },
      select: { id: true, agendaOnly: true },
    });
    if (!current) {
      return { success: false, error: "Paciente não encontrado ou sem permissão." };
    }
    // Renomear placeholder da agenda; ficha clínica não é criada/promovida pela marcação.
    await prisma.patient.update({
      where: { id: nextPatientId },
      data: {
        name,
        ...(current.agendaOnly ? { agendaOnly: true } : {}),
      },
    });
    renamedDisplayName = name;
  }

  const nextStart = startAt ?? existing.startAt;
  const nextEnd = endAt ?? existing.endAt;
  const effectiveStatus = status ?? existing.status;
  const becameCompleted =
    existing.status !== AppointmentStatus.COMPLETED &&
    effectiveStatus === AppointmentStatus.COMPLETED;

  if (nextEnd.getTime() <= nextStart.getTime()) {
    return { success: false, error: "endAt deve ser posterior a startAt." };
  }

  const willBeActive = !appointmentFreesSlot(effectiveStatus);
  const becameNoShow =
    existing.status !== AppointmentStatus.NO_SHOW &&
    effectiveStatus === AppointmentStatus.NO_SHOW;

  if (becameNoShow && existing.status !== AppointmentStatus.SCHEDULED) {
    return {
      success: false,
      error: "Só marcações agendadas podem ser registradas como falta.",
    };
  }

  let sanitizedNoShowReason: string | undefined;
  if (status === AppointmentStatus.NO_SHOW || (noShowReason !== undefined && existing.status === AppointmentStatus.NO_SHOW)) {
    const reason = sanitizeText(noShowReason ?? existing.noShowReason ?? "");
    if (reason.length < 3) {
      return { success: false, error: "Informe a justificativa da falta (mínimo 3 caracteres)." };
    }
    sanitizedNoShowReason = reason;
  }

  if (willBeActive) {
    const overlap = await findAppointmentOverlap(userId, nextStart, nextEnd, {
      excludeAppointmentId: appointmentId,
    });
    if (overlap.overlapping) {
      const durationMin = Math.round((nextEnd.getTime() - nextStart.getTime()) / 60_000);
      const tz = timezoneAtBooking ?? existing.timezoneAtBooking;
      const suggestions = await suggestAlternativeSlots({
        professionalUserId: userId,
        preferredStartUtc: nextStart,
        durationMinutes: Math.max(15, durationMin),
        timezone: tz,
      });
      return {
        success: false,
        error:
          "Horário indisponível (conflito com outra marcação)." +
          formatSuggestedSlotsMessage(suggestions),
        suggestedSlots: suggestions,
      };
    }
  }

  const metaTouched =
    visitKind !== undefined ||
    careSetting !== undefined ||
    priceCents !== undefined ||
    notes !== undefined ||
    patientServiceSessionId !== undefined ||
    professionalServiceId !== undefined ||
    serviceSpaceId !== undefined ||
    patientId !== undefined;

  let resolvedMeta: ResolvedAppointmentMeta | null = null;
  if (metaTouched) {
    const metaRes = await resolveAppointmentMetaForWrite({
      professionalUserId: userId,
      patientId: nextPatientId,
      visitKind,
      careSetting,
      priceCents,
      notes,
      patientServiceSessionId,
      professionalServiceId,
      serviceSpaceId,
      currentAppointmentId: appointmentId,
      existing: {
        visitKind: existing.visitKind,
        careSetting: existing.careSetting,
        priceCents: existing.priceCents,
        notes: existing.notes,
        patientServiceSessionId: existing.patientServiceSessionId,
        professionalServiceId: existing.professionalServiceId,
        serviceSpaceId: existing.serviceSpaceId,
      },
    });
    if (!metaRes.ok) {
      return { success: false, error: metaRes.error };
    }
    resolvedMeta = metaRes.data;
  }

  await prisma.appointment.update({
    where: { id: appointmentId },
    data: {
      ...(patientId !== undefined ? { patientId: nextPatientId } : {}),
      ...(startAt !== undefined ? { startAt: nextStart } : {}),
      ...(endAt !== undefined ? { endAt: nextEnd } : {}),
      ...(status !== undefined ? { status } : {}),
      // GOOGLE_SYNC e títulos tipo "FECHADO" usam `title` no card — manter alinhado ao nome.
      ...(renamedDisplayName !== null
        ? { title: renamedDisplayName }
        : title !== undefined
          ? { title: title === null ? null : sanitizeText(title) }
          : {}),
      ...(timezoneAtBooking !== undefined ? { timezoneAtBooking } : {}),
      ...(resolvedMeta
        ? {
            visitKind: resolvedMeta.visitKind,
            careSetting: resolvedMeta.careSetting,
            priceCents: resolvedMeta.priceCents,
            notes: resolvedMeta.notes,
            patientServiceSessionId: resolvedMeta.patientServiceSessionId,
            professionalServiceId: resolvedMeta.professionalServiceId,
            serviceSpaceId: resolvedMeta.serviceSpaceId,
          }
        : {}),
      ...(confirmationStatus !== undefined
        ? { confirmationStatus }
        : becameCompleted
          ? { confirmationStatus: AppointmentConfirmationStatus.CONFIRMED }
          : {}),
      ...(sanitizedNoShowReason !== undefined ? { noShowReason: sanitizedNoShowReason } : {}),
      ...(becameNoShow ? { patientServiceSessionId: null } : {}),
    },
  });

  let completionEffects: AppointmentCompletionEffects | undefined;

  if (becameCompleted) {
    const tz = timezoneAtBooking ?? existing.timezoneAtBooking;
    try {
      completionEffects = await runAppointmentCompletionFinanceEffects({
        id: appointmentId,
        patientId: nextPatientId,
        professionalUserId: userId,
        startAt: nextStart,
        timezoneAtBooking: tz,
        patientServiceSessionId:
          resolvedMeta?.patientServiceSessionId ?? existing.patientServiceSessionId,
      });
    } catch (err) {
      console.error("[appointment] efeitos financeiros ao concluir:", err);
    }
  }

  scheduleGoogleCalendarPush(userId, appointmentId);
  scheduleMarketplaceSlotSync(userId);
  void import("@/lib/marketplace/dual-booking").then((mod) =>
    mod.mirrorAppointmentOntoDualLink(appointmentId),
  );

  return {
    success: true,
    data: { id: appointmentId, becameCompleted, patientId: nextPatientId, completionEffects },
  };
}

export type AppointmentRemovalMode = "agenda" | "system";

/**
 * Remove a marcação da agenda.
 * - Realizada (COMPLETED): só some da grade (status CANCELLED). Sessão financeira,
 *   evolução e consumo de pacote permanecem.
 * - Não realizada (SCHEDULED / CANCELLED): apaga o registro da marcação no sistema.
 */
export async function cancelAppointmentForUser(
  userId: string,
  input: unknown,
  activeIntraUser: ActiveIntraUser | null = null,
): Promise<AppointmentServiceResult<{ id: string; removal: AppointmentRemovalMode }>> {
  const parsed = cancelAppointmentInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join(" ") };
  }

  const { appointmentId } = parsed.data;

  /**
   * Segregação Intra User (alinhada a listAppointmentsInRangeForUser):
   * - ADMIN / sem perfil MEMBER: qualquer marcação do tenant.
   * - MEMBER: só marcações em que atende OU pacientes acessíveis (próprios/shared).
   */
  const memberScope =
    activeIntraUser && activeIntraUser.role === "MEMBER"
      ? {
          OR: [
            { intraUserId: activeIntraUser.id },
            {
              patient: {
                OR: [{ ownerId: activeIntraUser.id }, { isShared: true }],
              },
            },
          ],
        }
      : {};

  const existing = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      professionalUserId: userId,
      ...memberScope,
    },
    select: { id: true, status: true, googleCalendarEventId: true },
  });
  if (!existing) {
    return { success: false, error: "Marcação não encontrada." };
  }

  // Realizada: tira da agenda sem apagar sessão/financeiro/evolução.
  // Fault-tolerant: marca CANCELLED já (objetivo é sair da grade) e delega a
  // limpeza do Google ao push assíncrono — com status CANCELLED o sync apaga o
  // evento e zera o ID. Diferente do hard-delete, a linha persiste, então uma
  // falha no Google não gera órfão: fica retryável, sem travar o utilizador.
  const dualLink = await prisma.showcaseDualBooking.findUnique({
    where: { appointmentId },
    select: { id: true },
  });
  if (dualLink) {
    await prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: AppointmentStatus.CANCELLED },
    });
    const { mirrorAppointmentOntoDualLink } = await import("@/lib/marketplace/dual-booking");
    await mirrorAppointmentOntoDualLink(appointmentId);
    try {
      const { syncAppointmentWithPatientGoogleCalendar } = await import(
        "@/lib/google-calendar-patient-sync"
      );
      await syncAppointmentWithPatientGoogleCalendar(appointmentId);
    } catch (err) {
      logger.warn("Falha ao espelhar desmarcação na agenda do paciente", {
        feature: "dual-booking",
        appointmentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    scheduleGoogleCalendarPush(userId, appointmentId);
    scheduleMarketplaceSlotSync(userId);
    return { success: true, data: { id: appointmentId, removal: "agenda" } };
  }

  if (existing.status === AppointmentStatus.COMPLETED) {
    await prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: AppointmentStatus.CANCELLED },
    });
    scheduleGoogleCalendarPush(userId, appointmentId);
    scheduleMarketplaceSlotSync(userId);
    return { success: true, data: { id: appointmentId, removal: "agenda" } };
  }

  // Não realizada: a agenda interna é a fonte de verdade. Tenta limpar o evento
  // no Google quando houver ligação + permissão; se não houver Calendar ligado,
  // faltar escopo ou o sync falhar, a exclusão no sistema segue na mesma.
  try {
    await unlinkPatientGoogleCalendarEvent(appointmentId);
  } catch (err) {
    logger.warn("Falha best-effort ao remover evento Google do paciente", {
      feature: "appointment-delete",
      userId,
      appointmentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (existing.googleCalendarEventId) {
    try {
      const unlink = await unlinkGoogleCalendarEventForAppointment(userId, appointmentId);
      // synced permanece true no best-effort; action "skip" = evento remoto
      // não foi apagado (sem permissão/rede/já sumiu) — ainda assim seguimos.
      if (unlink.action === "skip") {
        logger.warn("Exclusão local sem sync Google (best-effort)", {
          feature: "appointment-delete",
          userId,
          appointmentId,
          reason: unlink.reason,
        });
      }
    } catch (err) {
      logger.warn("Falha best-effort ao remover evento Google na exclusão", {
        feature: "appointment-delete",
        userId,
        appointmentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // deleteMany: se outra request já apagou entre o find e aqui, count=0
  // (sem P2025) — exclusão idempotente.
  const deleted = await prisma.appointment.deleteMany({
    where: {
      id: appointmentId,
      professionalUserId: userId,
      ...memberScope,
    },
  });
  if (deleted.count === 0) {
    logger.info("Exclusão idempotente: marcação já ausente", {
      feature: "appointment-delete",
      userId,
      appointmentId,
    });
  }

  scheduleMarketplaceSlotSync(userId);
  return { success: true, data: { id: appointmentId, removal: "system" } };
}

export async function listAppointmentsInRangeForUser(
  userId: string,
  input: unknown,
  activeIntraUser: ActiveIntraUser | null = null,
): Promise<AppointmentServiceResult<AppointmentListItem[]>> {
  const parsed = listAppointmentsRangeSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join(" ") };
  }
  const { start, end, serviceSpaceId } = parsed.data;

  /**
   * Segregação Intra User:
   * - ADMIN (ou sem perfil / plano individual): todas as marcações do tenant.
   * - MEMBER: só marcações em que atende OU pacientes que pode aceder (próprios/shared).
   */
  const memberScope =
    activeIntraUser && activeIntraUser.role === "MEMBER"
      ? {
          OR: [
            { intraUserId: activeIntraUser.id },
            {
              patient: {
                OR: [{ ownerId: activeIntraUser.id }, { isShared: true }],
              },
            },
          ],
        }
      : {};

  const spaceClause = serviceSpaceWhere(parseServiceSpaceViewParam(serviceSpaceId));

  const rows = await prisma.appointment.findMany({
    where: {
      professionalUserId: userId,
      status: { not: AppointmentStatus.CANCELLED },
      startAt: { lt: end },
      endAt: { gt: start },
      ...memberScope,
      ...(spaceClause ?? {}),
    },
    orderBy: { startAt: "asc" },
    select: {
      id: true,
      patientId: true,
      patient: { select: { name: true, agendaColor: true } },
      intraUserId: true,
      intraUser: { select: { name: true, color: true } },
      startAt: true,
      endAt: true,
      status: true,
      title: true,
      timezoneAtBooking: true,
      source: true,
      visitKind: true,
      careSetting: true,
      priceCents: true,
      notes: true,
      patientServiceSessionId: true,
      professionalServiceId: true,
      professionalService: { select: { name: true } },
      serviceSpaceId: true,
      serviceSpace: { select: { name: true, color: true } },
      patientServiceSession: {
        select: {
          purchase: { select: { service: { select: { name: true } } } },
        },
      },
      confirmationStatus: true,
      noShowReason: true,
      recurrenceSeriesId: true,
      evolution: { select: { id: true } },
      financialTransaction: { select: { id: true } },
      originatedPurchase: {
        select: {
          transactions: {
            where: { kind: FinancialTransactionKind.INCOME },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });

  return {
    success: true,
    data: rows.map((r) => ({
      id: r.id,
      patientId: r.patientId,
      patientName: appointmentPatientDisplayName({
        source: r.source,
        title: r.title,
        patientName: r.patient.name,
      }),
      patientAgendaColor: resolvePatientAgendaColor(r.patientId, r.patient.agendaColor),
      intraUserId: r.intraUserId,
      professionalName: r.intraUser?.name ?? null,
      professionalColor: r.intraUser?.color ?? null,
      startAt: r.startAt,
      endAt: r.endAt,
      status: r.status,
      title: r.title,
      timezoneAtBooking: r.timezoneAtBooking,
      source: r.source,
      visitKind: r.visitKind,
      careSetting: r.careSetting,
      priceCents: r.priceCents,
      notes: r.notes,
      patientServiceSessionId: r.patientServiceSessionId,
      professionalServiceId: r.professionalServiceId,
      serviceName:
        r.professionalService?.name ??
        r.patientServiceSession?.purchase.service.name ??
        null,
      serviceSpaceId: r.serviceSpaceId,
      serviceSpaceName: r.serviceSpace?.name ?? null,
      serviceSpaceColor: r.serviceSpace?.color ?? null,
      hasFinanceIncome:
        Boolean(r.financialTransaction) ||
        Boolean(r.originatedPurchase?.transactions.length),
      confirmationStatus: r.confirmationStatus,
      evolutionId: r.evolution?.id ?? null,
      hasEvolution: Boolean(r.evolution),
      noShowReason: r.noShowReason,
      recurrenceSeriesId: r.recurrenceSeriesId,
    })),
  };
}

export async function listAppointmentPatientsForUser(
  userId: string,
  activeIntraUser: ActiveIntraUser | null = null,
): Promise<AppointmentServiceResult<Array<{ id: string; name: string }>>> {
  const patients = await prisma.patient.findMany({
    where: {
      ...buildPatientScopeWhere({ tenantId: userId, activeIntraUser }),
      ...clinicalPatientWhere,
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return { success: true, data: patients };
}
