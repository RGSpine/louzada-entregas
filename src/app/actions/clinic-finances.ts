"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { DateTime } from "luxon";
import {
  PatientServicePurchaseType,
  PatientServiceSessionStatus,
  FinancialTransactionKind,
  FinancialTransactionMethod,
  ExpenseNature,
  FinancialEntrySource,
  RecurringExpenseFrequency,
  SessionConsumptionSource,
  EvolutionSource,
  ServiceBillingMode,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import { normalizeCatalogServiceFields } from "@/lib/finance/catalog-service-name";
import {
  detectServiceBillingModeFromText,
  resolveMonthlyPeriodBounds,
} from "@/lib/finance/service-billing-mode";
import { splitCentsAcrossParts } from "@/lib/finance/split-cents";
import {
  consumePendingSessionsWithDatesInTx,
  consumePurchaseSessionsByDates,
  consumeSessionManually,
  reorderPurchaseSessionsChronologically,
} from "@/lib/finance/reconcile-session";
import { yyyyMmDdToSaoPauloNoon } from "@/lib/finance/portuguese-payment";
import { DEFAULT_SCHEDULE_TIMEZONE } from "@/lib/schedule-temporal-parse";
import {
  getFinanceAccessRole,
  requireFinanceAdmin,
  requirePatientServicesManage,
} from "@/lib/finance/finance-rbac";
import { assertServiceSpaceOwned } from "@/app/actions/service-spaces";
import {
  parseServiceSpaceViewParam,
  serviceSpaceWhere,
} from "@/lib/service-spaces/access";
import {
  getFinancePeriodReportForUser,
  type FinancePeriodReport,
} from "@/lib/finance/period-report";
import {
  materializeRecurringExpensesForRange,
  RECURRING_DEACTIVATED_VOID_REASON,
  RECURRING_DELETED_VOID_REASON,
  restoreDeactivatedRecurringTransactions,
  voidRecurringTransactionsFromPeriod,
} from "@/lib/finance/recurring-expense";
import {
  defaultRecurringStartedAt,
  materializeRecurringAroundNow,
} from "@/lib/finance/recurring-materialize";
import { exclusiveEndFromInclusiveUtc } from "@/lib/finance/period-bounds";
import type { TeamEvolutionAttendanceRow } from "@/lib/finance/team-evolution-attendance";
import { isPurchasePaymentAmountAllowed } from "@/lib/finance/card-installments";
import { getIntraUserContext } from "@/lib/intra-user/context";
import {
  assertPatientAccessible,
  getPatientAccessScope,
  PROFILE_REQUIRED_ERROR,
} from "@/lib/intra-user/patient-access";
import {
  buildPatientScopeWhere,
  canManagePatientServicesAccess,
} from "@/lib/intra-user/patient-scope";
import { requireOfficeFinanceUser } from "@/lib/office-finance-access";
import {
  createPurchaseSchema,
  evolutionBlocksStandalonePurchase,
  originAppointmentBlocksNewPurchase,
  P2_GATE_MESSAGES,
} from "@/lib/finance/purchase-schema";
import { buildFinanceDeepLink } from "@/lib/finance/finance-deep-link";

export type { FinancePeriodReport, FinancePeriodTotals } from "@/lib/finance/period-report";

/** Papel financeiro do perfil ativo para a UI condicional (ADMIN vê tudo; MEMBER restrito). */
export async function getFinanceAccess(): Promise<
  ClinicFinanceActionResult<{
    role: "ADMIN" | "MEMBER";
    /** Pode cadastrar planos / baixar sessões na ficha do paciente. */
    canManagePatientServices: boolean;
    /** Consultório/Clínica — painel admin de atendimentos por Intra User. */
    isTeamPlan: boolean;
  }>
> {
  const ctx = await getIntraUserContext();
  if (!ctx) {
    return { success: false, error: "Não autenticado." };
  }
  const planAccess = await requireOfficeFinanceUser();
  if (!planAccess.ok) {
    return { success: false, error: planAccess.error };
  }
  if (ctx.isClinica && (ctx.requiresProfileSelection || !ctx.activeIntraUser)) {
    return { success: false, error: "Selecione o perfil profissional para continuar." };
  }
  // Planos individuais (e dono sem seletor) operam como ADMIN; clínica usa o papel do perfil.
  const role: "ADMIN" | "MEMBER" = !ctx.isClinica
    ? "ADMIN"
    : ctx.activeIntraUser!.role;
  const canManagePatientServices = !ctx.isClinica
    ? true
    : canManagePatientServicesAccess(ctx.activeIntraUser);
  return { success: true, data: { role, canManagePatientServices, isTeamPlan: ctx.isClinica } };
}

export type ClinicFinanceActionResult<T = unknown> =
  | { success: true; data?: T }
  | { success: false; error: string };

/** Liga a venda ao cliente do laboratório. O caixa ainda grava na ficha interna usada pelo financeiro. */
async function resolveLabClientToPatientId(id: string, userId: string): Promise<string> {
  const dentist = await prisma.dentistClient.findFirst({
    where: { id, userId },
    select: { name: true },
  });
  if (!dentist) return id;
  const name = dentist.name.trim();
  const existing = await prisma.patient.findFirst({
    where: { userId, name, agendaOnly: true },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.patient.create({
    data: { userId, name, agendaOnly: true, isShared: true },
    select: { id: true },
  });
  return created.id;
}

async function assertPatientOwnedByProfessional(patientId: string, _professionalUserId: string) {
  void _professionalUserId;
  const access = await assertPatientAccessible(patientId);
  if (!access.ok) {
    return {
      ok: false as const,
      error: access.error ?? "Paciente não encontrado ou sem permissão.",
    };
  }
  return { ok: true as const };
}

const upsertServiceSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  defaultPriceCents: z.coerce.number().int().min(0).max(100_000_000),
  active: z.boolean().optional(),
  serviceSpaceId: z.string().min(1).nullable().optional(),
  billingMode: z.enum(["SESSION", "MONTHLY"]).optional(),
});

export async function upsertProfessionalService(
  input: unknown,
): Promise<ClinicFinanceActionResult<{ id: string }>> {
  const access = await requireOfficeFinanceUser();
  if (!access.ok) {
    return { success: false, error: access.error };
  }
  const userId = access.userId;
  const admin = await requireFinanceAdmin();
  if (!admin.ok) {
    return { success: false, error: admin.error };
  }
  const parsed = upsertServiceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join(" "),
    };
  }
  const { id, name, description, defaultPriceCents, active, serviceSpaceId, billingMode } =
    parsed.data;
  const normalized = normalizeCatalogServiceFields(name, description ?? null);
  const resolvedBillingMode =
    billingMode ??
    detectServiceBillingModeFromText(normalized.name, normalized.description);

  if (id) {
    const existing = await prisma.professionalService.findFirst({
      where: { id, userId },
      select: { id: true, serviceSpaceId: true },
    });
    if (!existing) {
      return { success: false, error: "Serviço não encontrado." };
    }
    const spaceCheck = await assertServiceSpaceOwned(
      serviceSpaceId === undefined ? undefined : serviceSpaceId,
      userId,
      {
        allowInactive:
          serviceSpaceId != null && existing.serviceSpaceId === serviceSpaceId,
      },
    );
    if (!spaceCheck.ok) return { success: false, error: spaceCheck.error };

    await prisma.professionalService.update({
      where: { id },
      data: {
        name: normalized.name,
        description: normalized.description ? sanitizeText(normalized.description) : null,
        defaultPriceCents,
        billingMode:
          resolvedBillingMode === "MONTHLY"
            ? ServiceBillingMode.MONTHLY
            : ServiceBillingMode.SESSION,
        ...(active !== undefined ? { active } : {}),
        ...(serviceSpaceId !== undefined ? { serviceSpaceId: spaceCheck.spaceId } : {}),
      },
    });
    revalidatePath("/dashboard/finances");
    return { success: true, data: { id } };
  }

  const spaceCheck = await assertServiceSpaceOwned(
    serviceSpaceId === undefined ? undefined : serviceSpaceId,
    userId,
  );
  if (!spaceCheck.ok) return { success: false, error: spaceCheck.error };

  const row = await prisma.professionalService.create({
    data: {
      userId,
      name: sanitizeText(normalized.name),
      description: normalized.description ? sanitizeText(normalized.description) : null,
      defaultPriceCents,
      billingMode:
        resolvedBillingMode === "MONTHLY"
          ? ServiceBillingMode.MONTHLY
          : ServiceBillingMode.SESSION,
      active: active ?? true,
      serviceSpaceId: spaceCheck.spaceId,
    },
    select: { id: true },
  });
  revalidatePath("/dashboard/finances");
  return { success: true, data: { id: row.id } };
}

const deleteServiceSchema = z.object({
  id: z.string().min(1),
});

export async function deleteProfessionalService(
  input: unknown,
): Promise<ClinicFinanceActionResult> {
  const access = await requireOfficeFinanceUser();
  if (!access.ok) {
    return { success: false, error: access.error };
  }
  const userId = access.userId;
  const admin = await requireFinanceAdmin();
  if (!admin.ok) {
    return { success: false, error: admin.error };
  }
  const parsed = deleteServiceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join(" "),
    };
  }

  const existing = await prisma.professionalService.findFirst({
    where: { id: parsed.data.id, userId },
    select: { id: true, name: true },
  });
  if (!existing) {
    return { success: false, error: "Serviço não encontrado." };
  }

  const linkedPurchases = await prisma.patientServicePurchase.count({
    where: { professionalServiceId: existing.id, professionalUserId: userId },
  });
  if (linkedPurchases > 0) {
    return {
      success: false,
      error:
        "Este serviço tem vendas vinculadas e não pode ser excluído. Desative-o no catálogo em vez disso.",
    };
  }

  await prisma.professionalService.delete({ where: { id: existing.id } });
  revalidatePath("/dashboard/finances");
  return { success: true };
}

const bulkImportServicesSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(500),
        description: z.string().trim().max(4000).optional(),
        defaultPriceCents: z.coerce.number().int().min(0).max(100_000_000).default(0),
        billingMode: z.enum(["SESSION", "MONTHLY"]).optional(),
      }),
    )
    .min(1)
    .max(50),
});

function preprocessBulkCatalogImport(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const body = input as { items?: unknown[] };
  if (!Array.isArray(body.items)) return input;
  return {
    items: body.items.map((item) => {
      if (!item || typeof item !== "object") return item;
      const row = item as {
        name?: unknown;
        description?: unknown;
        defaultPriceCents?: unknown;
        billingMode?: unknown;
      };
      if (typeof row.name !== "string") return item;
      const { name, description } = normalizeCatalogServiceFields(
        row.name,
        typeof row.description === "string" ? row.description : null,
      );
      const billingMode =
        row.billingMode === "MONTHLY" || row.billingMode === "SESSION"
          ? row.billingMode
          : detectServiceBillingModeFromText(name, description);
      return {
        ...row,
        name,
        description: description ?? undefined,
        billingMode,
      };
    }),
  };
}

export async function bulkImportProfessionalServices(
  input: unknown,
): Promise<ClinicFinanceActionResult<{ count: number }>> {
  const access = await requireOfficeFinanceUser();
  if (!access.ok) {
    return { success: false, error: access.error };
  }
  const userId = access.userId;
  const admin = await requireFinanceAdmin();
  if (!admin.ok) {
    return { success: false, error: admin.error };
  }
  const parsed = bulkImportServicesSchema.safeParse(preprocessBulkCatalogImport(input));
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join(" "),
    };
  }

  const existing = await prisma.professionalService.findMany({
    where: { userId },
    select: { name: true },
  });
  const existingNames = new Set(
    existing.map((row) =>
      row.name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim(),
    ),
  );

  let created = 0;
  for (const item of parsed.data.items) {
    const key = item.name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
    if (!key || existingNames.has(key)) continue;
    existingNames.add(key);
    await prisma.professionalService.create({
      data: {
        userId,
        name: sanitizeText(item.name),
        description: item.description ? sanitizeText(item.description) : null,
        defaultPriceCents: item.defaultPriceCents,
        billingMode:
          item.billingMode === "MONTHLY"
            ? ServiceBillingMode.MONTHLY
            : ServiceBillingMode.SESSION,
        active: true,
      },
    });
    created += 1;
  }

  if (created === 0) {
    return {
      success: false,
      error: "Nenhum serviço novo para importar (todos já existem no catálogo).",
    };
  }

  revalidatePath("/dashboard/finances");
  return { success: true, data: { count: created } };
}

export async function listProfessionalServices(): Promise<
  ClinicFinanceActionResult<
    Array<{
      id: string;
      name: string;
      description: string | null;
      defaultPriceCents: number;
      billingMode: ServiceBillingMode;
      active: boolean;
      serviceSpaceId: string | null;
      serviceSpaceName: string | null;
      serviceSpaceColor: string | null;
    }>
  >
> {
  const access = await requireOfficeFinanceUser();
  if (!access.ok) {
    return { success: false, error: access.error };
  }
  const userId = access.userId;
  const rows = await prisma.professionalService.findMany({
    where: { userId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      defaultPriceCents: true,
      billingMode: true,
      active: true,
      serviceSpaceId: true,
      serviceSpace: { select: { name: true, color: true } },
    },
  });
  return {
    success: true,
    data: rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      defaultPriceCents: r.defaultPriceCents,
      billingMode: r.billingMode,
      active: r.active,
      serviceSpaceId: r.serviceSpaceId,
      serviceSpaceName: r.serviceSpace?.name ?? null,
      serviceSpaceColor: r.serviceSpace?.color ?? null,
    })),
  };
}

async function consumeFirstPurchaseSessionInTx(
  tx: Prisma.TransactionClient,
  params: {
    purchaseId: string;
    professionalUserId: string;
    patientId: string;
    consumeAt: Date;
    evolutionId?: string;
  },
): Promise<boolean> {
  const calendarDayLocal = DateTime.fromJSDate(params.consumeAt, { zone: "utc" })
    .setZone(DEFAULT_SCHEDULE_TIMEZONE)
    .toFormat("yyyy-LL-dd");

  // Serializa baixas do mesmo paciente/dia. Não bloqueia 2ª evolução no mesmo dia
  // (só idempotência por evolutionId — alinhado a tryConsumePendingSessionForPatient).
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${params.professionalUserId}:${params.patientId}:${calendarDayLocal}`}))`,
  );

  if (params.evolutionId) {
    const already = await tx.sessionConsumptionEvent.findUnique({
      where: { evolutionId: params.evolutionId },
      select: { id: true },
    });
    if (already) return false;
  }

  const first = await tx.patientServiceSession.findFirst({
    where: {
      purchaseId: params.purchaseId,
      status: PatientServiceSessionStatus.PENDING,
    },
    orderBy: { sequence: "asc" },
    select: { id: true },
  });
  if (!first) return false;

  const claimed = await tx.patientServiceSession.updateMany({
    where: {
      id: first.id,
      status: PatientServiceSessionStatus.PENDING,
    },
    data: {
      status: PatientServiceSessionStatus.CONSUMED,
      consumedAt: params.consumeAt,
    },
  });
  if (claimed.count !== 1) return false;

  await tx.sessionConsumptionEvent.create({
    data: {
      professionalUserId: params.professionalUserId,
      patientId: params.patientId,
      sessionId: first.id,
      source: params.evolutionId
        ? SessionConsumptionSource.EVOLUTION_RECORDED
        : SessionConsumptionSource.MANUAL,
      consumedAtAnchor: params.consumeAt,
      calendarDayLocal,
      appointmentId: null,
      evolutionId: params.evolutionId ?? null,
    },
  });

  await reorderPurchaseSessionsChronologically(tx, params.purchaseId);

  return true;
}

/**
 * Baixa histórica (áudio Serviços/Fiscal): marca as primeiras N sessões PENDING
 * como CONSUMED nas datas informadas (ordem cronológica do array).
 */
async function consumePreConsumedSessionsInTx(
  tx: Prisma.TransactionClient,
  params: {
    purchaseId: string;
    professionalUserId: string;
    patientId: string;
    sessions: Array<{ consumedAt: Date }>;
  },
): Promise<number> {
  if (params.sessions.length === 0) return 0;
  const { consumed } = await consumePendingSessionsWithDatesInTx(tx, {
    purchaseId: params.purchaseId,
    professionalUserId: params.professionalUserId,
    patientId: params.patientId,
    dates: params.sessions.map((s) => s.consumedAt),
  });
  return consumed;
}

/**
 * P2: evolução vinculada à Agenda não pode abrir venda paralela na Nova Evolução.
 * A marcação é dona do serviço / receita / baixa de sessão.
 */
async function assertEvolutionAllowsStandalonePurchase(params: {
  userId: string;
  patientId: string;
  evolutionId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const evo = await prisma.evolution.findFirst({
    where: {
      id: params.evolutionId,
      patientId: params.patientId,
      patient: { userId: params.userId },
    },
    select: {
      id: true,
      appointmentId: true,
      appointment: {
        select: {
          id: true,
          patientServiceSessionId: true,
          originatedPurchase: { select: { id: true } },
        },
      },
    },
  });
  if (!evo) {
    return { ok: false, error: "Evolução não encontrada para este paciente." };
  }
  if (evolutionBlocksStandalonePurchase(evo)) {
    return {
      ok: false,
      error: P2_GATE_MESSAGES.evolutionAgendaOwned,
    };
  }
  return { ok: true };
}

/**
 * P2: impede contornar a guarda omitindo `evolutionId`.
 * No dia civil atual, evolução com appointmentId bloqueia venda standalone
 * sem `originAppointmentId` (a marcação é dona do financeiro).
 */
async function assertNoAgendaOwnedVisitBlocksStandalonePurchase(params: {
  userId: string;
  patientId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const dayLocal = DateTime.now().setZone(DEFAULT_SCHEDULE_TIMEZONE);
  const startUtc = dayLocal.startOf("day").toUTC().toJSDate();
  const endUtc = dayLocal.endOf("day").toUTC().toJSDate();

  const agendaLinkedEvo = await prisma.evolution.findFirst({
    where: {
      patientId: params.patientId,
      patient: { userId: params.userId },
      appointmentId: { not: null },
      createdAt: { gte: startUtc, lte: endUtc },
    },
    select: { id: true },
  });
  if (agendaLinkedEvo) {
    return {
      ok: false,
      error: P2_GATE_MESSAGES.dayAgendaOwned,
    };
  }

  return { ok: true };
}

/**
 * P2: marcação de origem já ligada a sessão/pacote não aceita nova venda
 * (exceto replay idempotente da mesma compra, tratado depois).
 */
async function assertOriginAppointmentAllowsNewPurchase(params: {
  userId: string;
  patientId: string;
  originAppointmentId: string;
  idempotencyKey?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const appt = await prisma.appointment.findFirst({
    where: {
      id: params.originAppointmentId,
      professionalUserId: params.userId,
      patientId: params.patientId,
    },
    select: {
      id: true,
      patientServiceSessionId: true,
      originatedPurchase: {
        select: { id: true, idempotencyKey: true },
      },
      financialTransaction: {
        select: { id: true, kind: true, voidedAt: true },
      },
    },
  });
  if (!appt) {
    return {
      ok: false,
      error: "A marcação de origem não pertence ao paciente selecionado.",
    };
  }

  const gate = originAppointmentBlocksNewPurchase(
    {
      patientServiceSessionId: appt.patientServiceSessionId,
      originatedPurchase: appt.originatedPurchase,
      financialTransaction:
        appt.financialTransaction && !appt.financialTransaction.voidedAt
          ? {
              id: appt.financialTransaction.id,
              kind: appt.financialTransaction.kind,
            }
          : null,
    },
    params.idempotencyKey,
  );
  if (gate.blocked) {
    return { ok: false, error: gate.reason ?? "Venda não permitida para esta marcação." };
  }

  return { ok: true };
}

export async function createPatientPurchase(
  input: unknown,
): Promise<
  ClinicFinanceActionResult<{ purchaseId: string; firstSessionConsumed?: boolean }>
> {
  // ADMIN sempre; MEMBER só com permissão liberada pelo administrador da clínica.
  const access = await requirePatientServicesManage();
  if (!access.ok) {
    return { success: false, error: access.error };
  }
  const userId = access.userId;
  const parsed = createPurchaseSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join(" "),
    };
  }

  const {
    patientId: rawPatientId,
    professionalServiceId,
    type,
    billingMode: billingModeInput,
    agreedPriceCents,
    sessionCountTotal,
    notes,
    registerIncomePayment,
    paymentMethod,
    paymentOccurredAt,
    paymentDescription,
    paymentAmountCents,
    idempotencyKey,
    originAppointmentId,
    consumeFirstSessionAt,
    evolutionId,
    preConsumedSessions,
  } = parsed.data;

  const patientId = await resolveLabClientToPatientId(rawPatientId, userId);

  const own = await assertPatientOwnedByProfessional(patientId, userId);
  if (!own.ok) {
    return { success: false, error: own.error };
  }

  if (evolutionId) {
    const evoGate = await assertEvolutionAllowsStandalonePurchase({
      userId,
      patientId,
      evolutionId,
    });
    if (!evoGate.ok) {
      return { success: false, error: evoGate.error };
    }
  }

  if (originAppointmentId) {
    const apptGate = await assertOriginAppointmentAllowsNewPurchase({
      userId,
      patientId,
      originAppointmentId,
      idempotencyKey,
    });
    if (!apptGate.ok) {
      return { success: false, error: apptGate.error };
    }
  } else {
    // Sem marcação de origem: bloquear venda paralela no dia em que a Agenda já é dona.
    const dayGate = await assertNoAgendaOwnedVisitBlocksStandalonePurchase({
      userId,
      patientId,
    });
    if (!dayGate.ok) {
      return { success: false, error: dayGate.error };
    }
  }

  const svc = await prisma.professionalService.findFirst({
    where: { id: professionalServiceId, userId, active: true },
    select: { id: true, serviceSpaceId: true, billingMode: true, name: true, description: true },
  });
  if (!svc) {
    return { success: false, error: "Serviço ativo não encontrado no seu catálogo." };
  }

  const resolvedBillingModeRaw =
    billingModeInput ??
    (svc.billingMode === ServiceBillingMode.MONTHLY
      ? "MONTHLY"
      : detectServiceBillingModeFromText(svc.name, svc.description));
  const resolvedBillingMode =
    resolvedBillingModeRaw === "MONTHLY"
      ? ServiceBillingMode.MONTHLY
      : ServiceBillingMode.SESSION;

  // Id explícito sobrescreve; senão: espaço da marcação de origem → catálogo.
  let spaceInput: string | null = null;
  if (parsed.data.serviceSpaceId != null && parsed.data.serviceSpaceId.length > 0) {
    spaceInput = parsed.data.serviceSpaceId;
  } else {
    let apptSpace: string | null = null;
    if (originAppointmentId) {
      const originAppt = await prisma.appointment.findFirst({
        where: { id: originAppointmentId, professionalUserId: userId },
        select: { serviceSpaceId: true },
      });
      apptSpace = originAppt?.serviceSpaceId ?? null;
    }
    spaceInput = apptSpace ?? svc.serviceSpaceId;
  }
  const spaceCheck = await assertServiceSpaceOwned(spaceInput, userId);
  if (!spaceCheck.ok) return { success: false, error: spaceCheck.error };
  const resolvedSpaceId = spaceCheck.spaceId;

  const purchaseType = PatientServicePurchaseType.SINGLE;
  void type;
  const sessions =
    purchaseType === PatientServicePurchaseType.SINGLE ? 1 : (sessionCountTotal as number);

  const periodAnchor = paymentOccurredAt ?? new Date();
  const monthlyPeriod =
    resolvedBillingMode === ServiceBillingMode.MONTHLY
      ? resolveMonthlyPeriodBounds(periodAnchor)
      : null;

  const allocation = splitCentsAcrossParts(agreedPriceCents, sessions);
  const incomeAmountCents = paymentAmountCents ?? agreedPriceCents;
  if (
    registerIncomePayment &&
    !isPurchasePaymentAmountAllowed(agreedPriceCents, incomeAmountCents)
  ) {
    return {
      success: false,
      error:
        "O valor recebido deve ser pelo menos o acordado e no máximo o acordado + 100% (juros).",
    };
  }

  try {
    // Pacotes com muitas sessões pré-consumidas (áudio) precisam de timeout maior
    // que o default 5s — mesma causa do P2028 na baixa em lote.
    const purchaseTxTimeoutMs = Math.min(
      60_000,
      Math.max(
        20_000,
        15_000 + (preConsumedSessions?.length ?? 0) * 2_000,
      ),
    );
    const result = await prisma.$transaction(
      async (tx) => {
      const existingPurchase =
        idempotencyKey || originAppointmentId
          ? await tx.patientServicePurchase.findFirst({
              where: {
                professionalUserId: userId,
                OR: [
                  ...(idempotencyKey ? [{ idempotencyKey }] : []),
                  ...(originAppointmentId ? [{ originAppointmentId }] : []),
                ],
              },
              select: {
                id: true,
                patientId: true,
                professionalServiceId: true,
                type: true,
                sessionCountTotal: true,
                agreedPriceCents: true,
                transactions: {
                  where: { kind: FinancialTransactionKind.INCOME },
                  select: { amountCents: true, method: true, occurredAt: true },
                  take: 1,
                },
              },
            })
          : null;

      if (existingPurchase) {
        const sameCommand =
          existingPurchase.patientId === patientId &&
          existingPurchase.professionalServiceId === professionalServiceId &&
          existingPurchase.type === purchaseType &&
          existingPurchase.sessionCountTotal === sessions &&
          existingPurchase.agreedPriceCents === agreedPriceCents &&
          Boolean(existingPurchase.transactions.length) === Boolean(registerIncomePayment) &&
          (!registerIncomePayment ||
            (existingPurchase.transactions[0]?.amountCents === incomeAmountCents &&
              existingPurchase.transactions[0]?.method === paymentMethod &&
              existingPurchase.transactions[0]?.occurredAt.getTime() ===
                paymentOccurredAt?.getTime()));
        if (!sameCommand) {
          throw new Error("A chave desta operação já foi usada em outra venda.");
        }
        let firstSessionConsumed = false;
        if (consumeFirstSessionAt) {
          firstSessionConsumed = await consumeFirstPurchaseSessionInTx(tx, {
            purchaseId: existingPurchase.id,
            professionalUserId: userId,
            patientId,
            consumeAt: consumeFirstSessionAt,
            evolutionId,
          });
        }
        return { purchaseId: existingPurchase.id, firstSessionConsumed };
      }

      if (originAppointmentId) {
        const origin = await tx.appointment.findFirst({
          where: {
            id: originAppointmentId,
            professionalUserId: userId,
            patientId,
          },
          select: { id: true },
        });
        if (!origin) {
          throw new Error("A marcação de origem não pertence ao paciente selecionado.");
        }
      }

      const purchase = await tx.patientServicePurchase.create({
        data: {
          professionalUserId: userId,
          patientId,
          professionalServiceId,
          serviceSpaceId: resolvedSpaceId,
          idempotencyKey: idempotencyKey ?? null,
          originAppointmentId: originAppointmentId ?? null,
          type: purchaseType,
          billingMode: resolvedBillingMode,
          periodStart: monthlyPeriod?.periodStart ?? null,
          periodEnd: monthlyPeriod?.periodEnd ?? null,
          sessionCountTotal: sessions,
          agreedPriceCents,
          notes: notes ? sanitizeText(notes) : null,
        },
        select: { id: true },
      });

      for (let seq = 0; seq < sessions; seq++) {
        await tx.patientServiceSession.create({
          data: {
            purchaseId: purchase.id,
            sequence: seq + 1,
            status: PatientServiceSessionStatus.PENDING,
            allocatedPriceCents: allocation[seq] ?? 0,
          },
        });
      }

      if (registerIncomePayment) {
        if (!paymentMethod || !paymentOccurredAt) {
          throw new Error("Pagamento incompleto: informe método e data.");
        }
        await tx.financialTransaction.create({
          data: {
            professionalUserId: userId,
            patientId,
            purchaseId: purchase.id,
            serviceSpaceId: resolvedSpaceId,
            kind: FinancialTransactionKind.INCOME,
            amountCents: incomeAmountCents,
            occurredAt: paymentOccurredAt,
            method: paymentMethod as FinancialTransactionMethod,
            description: paymentDescription
              ? sanitizeText(paymentDescription)
              : "Recebimento venda de serviço / pacote",
          },
        });
      }

      let firstSessionConsumed = false;
      if (consumeFirstSessionAt) {
        firstSessionConsumed = await consumeFirstPurchaseSessionInTx(tx, {
          purchaseId: purchase.id,
          professionalUserId: userId,
          patientId,
          consumeAt: consumeFirstSessionAt,
          evolutionId,
        });
      } else if (preConsumedSessions && preConsumedSessions.length > 0) {
        const n = await consumePreConsumedSessionsInTx(tx, {
          purchaseId: purchase.id,
          professionalUserId: userId,
          patientId,
          sessions: preConsumedSessions,
        });
        firstSessionConsumed = n > 0;
      }

      return { purchaseId: purchase.id, firstSessionConsumed };
    },
      { maxWait: 15_000, timeout: purchaseTxTimeoutMs },
    );

    revalidatePath("/dashboard/finances");
    revalidatePath(`/dashboard/patients/${patientId}`);
    return {
      success: true,
      data: {
        purchaseId: result.purchaseId,
        firstSessionConsumed: result.firstSessionConsumed || undefined,
      },
    };
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002" &&
      (idempotencyKey || originAppointmentId)
    ) {
      const existing = await prisma.patientServicePurchase.findFirst({
        where: {
          professionalUserId: userId,
          OR: [
            ...(idempotencyKey ? [{ idempotencyKey }] : []),
            ...(originAppointmentId ? [{ originAppointmentId }] : []),
          ],
        },
        select: {
          id: true,
          patientId: true,
          professionalServiceId: true,
          type: true,
          sessionCountTotal: true,
          agreedPriceCents: true,
          transactions: {
            where: { kind: FinancialTransactionKind.INCOME },
            select: { amountCents: true, method: true, occurredAt: true },
            take: 1,
          },
        },
      });
      if (
        existing &&
        existing.patientId === patientId &&
        existing.professionalServiceId === professionalServiceId &&
        existing.type === purchaseType &&
        existing.sessionCountTotal === sessions &&
        existing.agreedPriceCents === agreedPriceCents &&
        Boolean(existing.transactions.length) === Boolean(registerIncomePayment) &&
        (!registerIncomePayment ||
          (existing.transactions[0]?.amountCents === incomeAmountCents &&
            existing.transactions[0]?.method === paymentMethod &&
            existing.transactions[0]?.occurredAt.getTime() === paymentOccurredAt?.getTime()))
      ) {
        let firstSessionConsumed = false;
        if (consumeFirstSessionAt) {
          firstSessionConsumed = await prisma.$transaction((tx) =>
            consumeFirstPurchaseSessionInTx(tx, {
              purchaseId: existing.id,
              professionalUserId: userId,
              patientId,
              consumeAt: consumeFirstSessionAt,
              evolutionId,
            }),
          );
        }
        return {
          success: true,
          data: {
            purchaseId: existing.id,
            firstSessionConsumed: firstSessionConsumed || undefined,
          },
        };
      }
    }
    const msg = e instanceof Error ? e.message : "Erro ao criar compra.";
    return { success: false, error: msg };
  }
}

const createTxSchema = z.object({
  kind: z.enum(["INCOME", "EXPENSE"]),
  amountCents: z.coerce.number().int().min(1).max(500_000_000),
  occurredAt: z.coerce.date(),
  method: z.enum(["PIX", "CASH", "CARD", "TRANSFER", "OTHER"]),
  description: z.string().max(2000).optional(),
  patientId: z.string().min(1).optional(),
  purchaseId: z.string().min(1).optional(),
  /** Só relevante para EXPENSE. Default VARIABLE (flutuante) quando despesa. */
  expenseNature: z.enum(["FIXED", "VARIABLE"]).optional(),
  category: z.string().trim().max(120).optional(),
  source: z.enum(["MANUAL", "AUDIO", "PHOTO", "AGENT", "RECURRING"]).optional(),
  serviceSpaceId: z.string().min(1).nullable().optional(),
});

export async function createFinancialTransaction(
  input: unknown,
): Promise<ClinicFinanceActionResult<{ id: string; linkedPurchaseId?: string }>> {
  const access = await requireOfficeFinanceUser();
  if (!access.ok) {
    return { success: false, error: access.error };
  }
  const userId = access.userId;

  const role = await getFinanceAccessRole();
  if (role === "DENIED") {
    return { success: false, error: "Selecione o perfil profissional para continuar." };
  }

  const parsed = createTxSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join(" "),
    };
  }
  const {
    kind,
    amountCents,
    occurredAt,
    method,
    description,
    patientId: rawPatientId,
    purchaseId,
    expenseNature,
    category,
    source,
    serviceSpaceId,
  } = parsed.data;

  const patientId = rawPatientId
    ? await resolveLabClientToPatientId(rawPatientId, userId)
    : undefined;

  const spaceCheck = await assertServiceSpaceOwned(
    serviceSpaceId === undefined ? undefined : serviceSpaceId,
    userId,
  );
  if (!spaceCheck.ok) return { success: false, error: spaceCheck.error };

  // MEMBER: só entradas (INCOME) vinculadas a paciente no escopo; nunca despesas globais.
  // ADMIN e MEMBER: toda receita no caixa exige paciente (não há entrada «órfã»).
  if (kind === "INCOME" && !patientId) {
    return {
      success: false,
      error: "Vincule a receita a um paciente. Cadastre ou selecione o paciente antes de registrar.",
    };
  }

  if (role === "MEMBER") {
    if (kind !== "INCOME") {
      return {
        success: false,
        error: "Membros da equipe só podem registrar entradas (receitas), não despesas.",
      };
    }
  }

  if (patientId) {
    const own = await assertPatientOwnedByProfessional(patientId, userId);
    if (!own.ok) {
      return { success: false, error: own.error };
    }
  }

  let resolvedPatientId = patientId ?? null;
  let resolvedAmountCents = amountCents;
  let resolvedSpaceId = spaceCheck.spaceId;
  let resolvedPurchaseId = purchaseId ?? null;

  // Entrada com paciente mas sem compra: vincula automaticamente se houver
  // exatamente 1 compra pendente compatível (valor acordado = pago, ou pago =
  // acordado + juros flat até 100%).
  if (
    kind === "INCOME" &&
    !resolvedPurchaseId &&
    patientId &&
    amountCents > 0
  ) {
    const candidates = await prisma.patientServicePurchase.findMany({
      where: {
        professionalUserId: userId,
        patientId,
      },
      select: {
        id: true,
        patientId: true,
        agreedPriceCents: true,
        serviceSpaceId: true,
        transactions: {
          where: { kind: FinancialTransactionKind.INCOME, voidedAt: null },
      select: { id: true },
          take: 1,
        },
      },
      orderBy: { purchasedAt: "desc" },
      take: 20,
    });
    const unpaid = candidates.filter((c) => c.transactions.length === 0);
    const exact = unpaid.filter((c) => c.agreedPriceCents === amountCents);
    if (exact.length === 1) {
      resolvedPurchaseId = exact[0]!.id;
    } else {
      const withInterest = unpaid.filter((c) =>
        isPurchasePaymentAmountAllowed(c.agreedPriceCents, amountCents),
      );
      if (withInterest.length === 1) {
        resolvedPurchaseId = withInterest[0]!.id;
      }
    }
  }

  if (resolvedPurchaseId) {
    // Pagamento de compra (explícito ou auto-vinculado): MEMBER precisa da mesma
    // permissão de serviços — senão omitir purchaseId contornava o gate.
    if (role === "MEMBER") {
      const servicesGate = await requirePatientServicesManage();
      if (!servicesGate.ok) {
        return { success: false, error: servicesGate.error };
      }
    }
    // Isolamento por tenant: professionalUserId = User (tenant) pagante.
    const purchase = await prisma.patientServicePurchase.findFirst({
      where: { id: resolvedPurchaseId, professionalUserId: userId },
      select: {
        id: true,
        patientId: true,
        agreedPriceCents: true,
        serviceSpaceId: true,
      },
    });
    if (!purchase) {
      return { success: false, error: "Compra não encontrada." };
    }
    // Compra manda no espaço da entrada (evita divergência cliente × compra).
    if (purchase.serviceSpaceId) {
      resolvedSpaceId = purchase.serviceSpaceId;
    }
    // MEMBER só referencia compras de pacientes no seu escopo; sem paciente → negar.
    if (role === "MEMBER") {
      if (!purchase.patientId) {
        return {
          success: false,
          error: "Membros só podem vincular compras associadas a um paciente acessível.",
        };
      }
      const ownPurchase = await assertPatientOwnedByProfessional(
        purchase.patientId,
        userId,
      );
      if (!ownPurchase.ok) {
        return { success: false, error: ownPurchase.error };
      }
      // Consistência: se a entrada também informa patientId, deve bater com a compra.
      if (patientId && patientId !== purchase.patientId) {
        return {
          success: false,
          error: "A compra informada não pertence ao paciente selecionado.",
        };
      }
    } else if (patientId && purchase.patientId && patientId !== purchase.patientId) {
      return {
        success: false,
        error: "A compra informada não pertence ao paciente selecionado.",
      };
    }

    // Pagamento: pelo menos o acordado; até +100% flat (juros no crédito).
    if (kind === "INCOME") {
      if (!isPurchasePaymentAmountAllowed(purchase.agreedPriceCents, amountCents)) {
        const minBrl = (purchase.agreedPriceCents / 100).toFixed(2).replace(".", ",");
        return {
          success: false,
          error: `O valor da entrada deve ser no mínimo o da compra (R$ ${minBrl}) e no máximo esse valor + 100% de juros.`,
        };
      }
      resolvedAmountCents = amountCents;
    }

    if (!resolvedPatientId) {
      resolvedPatientId = purchase.patientId;
    }
  }

  // Natureza só faz sentido em despesa; receita ignora. Default de despesa = VARIABLE.
  const resolvedNature =
    kind === "EXPENSE"
      ? ((expenseNature ?? "VARIABLE") as ExpenseNature)
      : null;

  try {
    const row = await prisma.$transaction(async (tx) => {
      // Serializa INCOME por compra (TOCTOU) até o índice único parcial estar aplicado.
      if (kind === "INCOME" && resolvedPurchaseId) {
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`purchase-income:${userId}:${resolvedPurchaseId}`}))`,
        );
        const already = await tx.financialTransaction.findFirst({
          where: {
            purchaseId: resolvedPurchaseId,
            kind: FinancialTransactionKind.INCOME,
            professionalUserId: userId,
            voidedAt: null,
          },
          select: { id: true },
        });
        if (already) {
          throw new Error("PURCHASE_INCOME_EXISTS");
        }
      }

      return tx.financialTransaction.create({
    data: {
      professionalUserId: userId,
      kind: kind as FinancialTransactionKind,
          amountCents: resolvedAmountCents,
      occurredAt,
      method: method as FinancialTransactionMethod,
      description: description ? sanitizeText(description) : null,
          patientId: resolvedPatientId,
          purchaseId: resolvedPurchaseId,
          serviceSpaceId: resolvedSpaceId,
      expenseNature: resolvedNature,
      category: category ? sanitizeText(category) : null,
      source: (source ?? "MANUAL") as FinancialEntrySource,
    },
    select: { id: true },
      });
  });
  revalidatePath("/dashboard/finances");
    if (resolvedPatientId) {
      revalidatePath(`/dashboard/patients/${resolvedPatientId}`);
    }
    return {
      success: true,
      data: {
        id: row.id,
        linkedPurchaseId: resolvedPurchaseId ?? undefined,
      },
    };
  } catch (e) {
    if (e instanceof Error && e.message === "PURCHASE_INCOME_EXISTS") {
      return {
        success: false,
        error: "Esta compra já possui entrada no Financeiro.",
      };
    }
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002" &&
      kind === "INCOME" &&
      resolvedPurchaseId
    ) {
      return {
        success: false,
        error: "Esta compra já possui entrada no Financeiro.",
      };
    }
    throw e;
  }
}

const listTxSchema = z.object({
  start: z.coerce.date(),
  end: z.coerce.date(),
  patientId: z.string().min(1).optional(),
  /** "all" ou id do espaço — visão consolidada vs filtrada. */
  serviceSpaceId: z.string().min(1).optional(),
  kind: z.enum(["INCOME", "EXPENSE"]).optional(),
  expenseNature: z.enum(["FIXED", "VARIABLE"]).optional(),
});

export async function listFinancialTransactions(
  input: unknown,
): Promise<
  ClinicFinanceActionResult<
    Array<{
      id: string;
      kind: FinancialTransactionKind;
      amountCents: number;
      occurredAt: Date;
      method: FinancialTransactionMethod;
      description: string | null;
      patientId: string | null;
      patientName: string | null;
      purchaseId: string | null;
      category: string | null;
      expenseNature: ExpenseNature | null;
      serviceSpaceId: string | null;
      serviceSpaceName: string | null;
      serviceSpaceColor: string | null;
      canVoid: boolean;
    }>
  >
> {
  const access = await requireOfficeFinanceUser();
  if (!access.ok) {
    return { success: false, error: access.error };
  }
  const userId = access.userId;
  const role = await getFinanceAccessRole();
  if (role === "DENIED") {
    return { success: false, error: PROFILE_REQUIRED_ERROR };
  }

  const parsed = listTxSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join(" "),
    };
  }
  const { start, end, patientId, serviceSpaceId } = parsed.data;
  if (end.getTime() <= start.getTime()) {
    return { success: false, error: "Intervalo de datas inválido." };
  }

  if (patientId) {
    const own = await assertPatientOwnedByProfessional(patientId, userId);
    if (!own.ok) {
      return { success: false, error: own.error };
    }
  }

  const spaceFilter = parseServiceSpaceViewParam(serviceSpaceId);
  const spaceClause = serviceSpaceWhere(spaceFilter);

  // ADMIN: materializa gastos fixos no intervalo antes do extrato (senão o líquido
  // e a lista ficam sem aluguel/software até abrir o relatório completo).
  // `end` é inclusivo (lte no extrato); materialize usa [start, endExclusive).
  if (role === "ADMIN") {
    await materializeRecurringExpensesForRange({
      professionalUserId: userId,
      startUtc: start,
      endUtc: exclusiveEndFromInclusiveUtc(end),
    });
  }

  // ADMIN: extrato completo. MEMBER: só INCOME de pacientes no seu escopo (não relatório global).
  const where: Prisma.FinancialTransactionWhereInput = {
      professionalUserId: userId,
      occurredAt: { gte: start, lte: end },
    voidedAt: null,
    ...(spaceClause ?? {}),
  };

  if (role === "MEMBER") {
    const scope = await getPatientAccessScope();
    if (!scope || scope.denied || !scope.activeIntraUser) {
      return { success: false, error: PROFILE_REQUIRED_ERROR };
    }
    // MEMBER: só INCOME de pacientes no escopo — resolve IDs explicitamente (fail-closed).
    where.kind = FinancialTransactionKind.INCOME;
    const scopeWhere = buildPatientScopeWhere({
      tenantId: scope.tenantId,
      activeIntraUser: scope.activeIntraUser,
    });
    const scopedPatients = await prisma.patient.findMany({
      where: scopeWhere,
      select: { id: true },
    });
    const scopedPatientIds = scopedPatients.map((p) => p.id);
    if (patientId) {
      where.patientId = scopedPatientIds.includes(patientId)
        ? patientId
        : { in: [] };
    } else if (scopedPatientIds.length > 0) {
      where.patientId = { in: scopedPatientIds };
    } else {
      where.patientId = { in: [] };
    }
  } else if (patientId) {
    where.patientId = patientId;
  }

  if (role === "ADMIN") {
    if (parsed.data.kind) where.kind = parsed.data.kind;
    if (parsed.data.expenseNature) where.expenseNature = parsed.data.expenseNature;
  }

  const rows = await prisma.financialTransaction.findMany({
    where,
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      kind: true,
      amountCents: true,
      occurredAt: true,
      method: true,
      description: true,
      patientId: true,
      patient: { select: { name: true } },
      purchaseId: true,
      category: true,
      expenseNature: true,
      serviceSpaceId: true,
      serviceSpace: { select: { name: true, color: true } },
      fiscalExportStatus: true,
      fiscalDocument: { select: { status: true } },
    },
  });

  const canVoidAsAdmin = role === "ADMIN";
  return {
    success: true,
    data: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      amountCents: r.amountCents,
      occurredAt: r.occurredAt,
      method: r.method,
      description: r.description,
      patientId: r.patientId,
      patientName: r.patient?.name ?? null,
      purchaseId: r.purchaseId,
      category: r.category,
      expenseNature: r.expenseNature,
      serviceSpaceId: r.serviceSpaceId,
      serviceSpaceName: r.serviceSpace?.name ?? null,
      serviceSpaceColor: r.serviceSpace?.color ?? null,
      canVoid:
        canVoidAsAdmin &&
        r.fiscalDocument?.status !== "ISSUED" &&
        r.fiscalDocument?.status !== "QUEUED" &&
        r.fiscalDocument?.status !== "PROCESSING",
    })),
  };
}

export async function summarizeFinancialPeriod(input: unknown): Promise<
  ClinicFinanceActionResult<{
    incomeCents: number;
    expenseCents: number;
    netCents: number;
  }>
> {
  const listed = await listFinancialTransactions(input);
  if (!listed.success) {
    return listed;
  }
  const rows = listed.data ?? [];
  let incomeCents = 0;
  let expenseCents = 0;
  for (const t of rows) {
    if (t.kind === FinancialTransactionKind.INCOME) incomeCents += t.amountCents;
    else expenseCents += t.amountCents;
  }
  return {
    success: true,
    data: {
      incomeCents,
      expenseCents,
      netCents: incomeCents - expenseCents,
    },
  };
}

export async function listPatientPurchases(
  patientIdRaw: unknown,
): Promise<
  ClinicFinanceActionResult<
    Array<{
      purchase: {
        id: string;
        type: PatientServicePurchaseType;
        billingMode: ServiceBillingMode;
        periodStart: Date | null;
        periodEnd: Date | null;
        agreedPriceCents: number;
        purchasedAt: Date;
        notes: string | null;
        serviceName: string;
        sessionCountTotal: number;
      };
      pendingCount: number;
      consumedCount: number;
      /** Há pelo menos uma entrada INCOME ligada a esta compra no Financeiro. */
      hasIncomePayment: boolean;
      sessions: Array<{
        id: string;
        sequence: number;
        status: PatientServiceSessionStatus;
        consumedAt: Date | null;
        allocatedPriceCents: number;
        consumptionSource: "APPOINTMENT_COMPLETED" | "EVOLUTION_RECORDED" | "MANUAL" | null;
        evolutionId: string | null;
      }>;
    }>
  >
> {
  const access = await requireOfficeFinanceUser();
  if (!access.ok) {
    return { success: false, error: access.error };
  }
  const userId = access.userId;
  const patientIdParsed = z.string().min(1).safeParse(patientIdRaw);
  if (!patientIdParsed.success) {
    return { success: false, error: "Cliente inválido." };
  }
  const patientId = await resolveLabClientToPatientId(patientIdParsed.data, userId);
  const own = await assertPatientOwnedByProfessional(patientId, userId);
  if (!own.ok) {
    return { success: false, error: own.error };
  }

  const purchases = await prisma.patientServicePurchase.findMany({
    where: { professionalUserId: userId, patientId },
    orderBy: [{ purchasedAt: "desc" }],
    include: {
      service: { select: { name: true } },
      sessions: {
        select: {
          id: true,
          sequence: true,
          status: true,
          consumedAt: true,
          allocatedPriceCents: true,
          consumptions: {
            select: { source: true, evolutionId: true },
            take: 1,
          },
        },
        orderBy: { sequence: "asc" },
      },
      transactions: {
        where: { kind: FinancialTransactionKind.INCOME, voidedAt: null },
        select: { id: true },
        take: 1,
      },
    },
  });

  const data = purchases.map((p) => {
    const pendingCount = p.sessions.filter((s) => s.status === PatientServiceSessionStatus.PENDING)
      .length;
    const consumedCount = p.sessions.filter(
      (s) => s.status === PatientServiceSessionStatus.CONSUMED,
    ).length;
    return {
      purchase: {
        id: p.id,
        type: p.type,
        billingMode: p.billingMode,
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        agreedPriceCents: p.agreedPriceCents,
        purchasedAt: p.purchasedAt,
        notes: p.notes,
        serviceName: p.service.name,
        sessionCountTotal: p.sessionCountTotal,
      },
      pendingCount,
      consumedCount,
      hasIncomePayment: p.transactions.length > 0,
      sessions: p.sessions.map((s) => ({
        id: s.id,
        sequence: s.sequence,
        status: s.status,
        consumedAt: s.consumedAt,
        allocatedPriceCents: s.allocatedPriceCents,
        consumptionSource: s.consumptions[0]?.source ?? null,
        evolutionId: s.consumptions[0]?.evolutionId ?? null,
      })),
    };
  });

  return { success: true, data };
}

/**
 * Entradas (INCOME) do caixa vinculadas ao paciente — avulsas ou ligadas a compras.
 * Completa a ponte Financeiro → ficha Serviços/Fiscal.
 */
export async function listPatientCashEntries(
  patientIdRaw: unknown,
): Promise<
  ClinicFinanceActionResult<
    Array<{
      id: string;
      amountCents: number;
      occurredAt: Date;
      method: FinancialTransactionMethod;
      description: string | null;
      purchaseId: string | null;
      purchaseServiceName: string | null;
    }>
  >
> {
  const access = await requireOfficeFinanceUser();
  if (!access.ok) {
    return { success: false, error: access.error };
  }
  const userId = access.userId;
  const patientIdParsed = z.string().min(1).safeParse(patientIdRaw);
  if (!patientIdParsed.success) {
    return { success: false, error: "Cliente inválido." };
  }
  const patientId = await resolveLabClientToPatientId(patientIdParsed.data, userId);
  const own = await assertPatientOwnedByProfessional(patientId, userId);
  if (!own.ok) {
    return { success: false, error: own.error };
  }

  const rows = await prisma.financialTransaction.findMany({
    where: {
      professionalUserId: userId,
      patientId,
      kind: FinancialTransactionKind.INCOME,
      voidedAt: null,
    },
    orderBy: { occurredAt: "desc" },
    take: 100,
    select: {
      id: true,
      amountCents: true,
      occurredAt: true,
      method: true,
      description: true,
      purchaseId: true,
      purchase: { select: { service: { select: { name: true } } } },
    },
  });

  return {
    success: true,
    data: rows.map((r) => ({
      id: r.id,
      amountCents: r.amountCents,
      occurredAt: r.occurredAt,
      method: r.method,
      description: r.description,
      purchaseId: r.purchaseId,
      purchaseServiceName: r.purchase?.service?.name ?? null,
    })),
  };
}

// ============================================================
// Despesas fixas recorrentes (gastos fixos salvos)
// ============================================================

const upsertRecurringExpenseSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(200),
  amountCents: z.coerce.number().int().min(1).max(500_000_000),
  category: z.string().trim().max(120).optional(),
  method: z.enum(["PIX", "CASH", "CARD", "TRANSFER", "OTHER"]).optional(),
  frequency: z.enum(["WEEKLY", "MONTHLY", "YEARLY"]).optional(),
  anchorDay: z.coerce.number().int().min(1).max(31).optional(),
  notes: z.string().trim().max(2000).optional(),
  active: z.boolean().optional(),
  serviceSpaceId: z.string().min(1).nullable().optional(),
});

export async function upsertRecurringExpense(
  input: unknown,
): Promise<ClinicFinanceActionResult<{ id: string }>> {
  const access = await requireOfficeFinanceUser();
  if (!access.ok) {
    return { success: false, error: access.error };
  }
  const userId = access.userId;
  const admin = await requireFinanceAdmin();
  if (!admin.ok) {
    return { success: false, error: admin.error };
  }
  const parsed = upsertRecurringExpenseSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join(" "),
    };
  }
  const {
    id,
    name,
    amountCents,
    category,
    method,
    frequency,
    anchorDay,
    notes,
    active,
    serviceSpaceId,
  } = parsed.data;

  if (id) {
    const existing = await prisma.recurringExpense.findFirst({
      where: { id, professionalUserId: userId },
      select: { id: true, serviceSpaceId: true },
    });
    if (!existing) {
      return { success: false, error: "Despesa fixa não encontrada." };
    }
    const spaceCheck = await assertServiceSpaceOwned(
      serviceSpaceId === undefined ? undefined : serviceSpaceId,
      userId,
      {
        allowInactive:
          serviceSpaceId != null && existing.serviceSpaceId === serviceSpaceId,
      },
    );
    if (!spaceCheck.ok) return { success: false, error: spaceCheck.error };

    await prisma.recurringExpense.update({
      where: { id },
      data: {
    name: sanitizeText(name),
    amountCents,
    category: category ? sanitizeText(category) : null,
    method: (method ?? "OTHER") as FinancialTransactionMethod,
    frequency: (frequency ?? "MONTHLY") as RecurringExpenseFrequency,
    anchorDay: anchorDay ?? 1,
    notes: notes ? sanitizeText(notes) : null,
    ...(active !== undefined ? { active } : {}),
        ...(serviceSpaceId !== undefined ? { serviceSpaceId: spaceCheck.spaceId } : {}),
      },
    });
    await materializeRecurringAroundNow({ professionalUserId: userId });
    revalidatePath("/dashboard/finances");
    return { success: true, data: { id } };
  }

  const spaceCheck = await assertServiceSpaceOwned(
    serviceSpaceId === undefined ? undefined : serviceSpaceId,
    userId,
  );
  if (!spaceCheck.ok) return { success: false, error: spaceCheck.error };

  const freq = (frequency ?? "MONTHLY") as RecurringExpenseFrequency;
  const row = await prisma.recurringExpense.create({
    data: {
      professionalUserId: userId,
      name: sanitizeText(name),
      amountCents,
      category: category ? sanitizeText(category) : null,
      method: (method ?? "OTHER") as FinancialTransactionMethod,
      frequency: freq,
      anchorDay: anchorDay ?? 1,
      notes: notes ? sanitizeText(notes) : null,
      active: active ?? true,
      serviceSpaceId: spaceCheck.spaceId,
      startedAt: defaultRecurringStartedAt(freq),
    },
    select: { id: true },
  });
  await materializeRecurringAroundNow({ professionalUserId: userId });
  revalidatePath("/dashboard/finances");
  return { success: true, data: { id: row.id } };
}

export async function listRecurringExpenses(): Promise<
  ClinicFinanceActionResult<
    Array<{
      id: string;
      name: string;
      amountCents: number;
      category: string | null;
      method: FinancialTransactionMethod;
      frequency: RecurringExpenseFrequency;
      anchorDay: number;
      active: boolean;
      notes: string | null;
      serviceSpaceId: string | null;
    }>
  >
> {
  const access = await requireOfficeFinanceUser();
  if (!access.ok) {
    return { success: false, error: access.error };
  }
  const userId = access.userId;
  const admin = await requireFinanceAdmin();
  if (!admin.ok) {
    return { success: false, error: admin.error };
  }
  const rows = await prisma.recurringExpense.findMany({
    where: { professionalUserId: userId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      amountCents: true,
      category: true,
      method: true,
      frequency: true,
      anchorDay: true,
      active: true,
      notes: true,
      serviceSpaceId: true,
    },
  });
  return { success: true, data: rows };
}

const setRecurringActiveSchema = z.object({
  id: z.string().min(1),
  active: z.boolean(),
});

export async function setRecurringExpenseActive(
  input: unknown,
): Promise<ClinicFinanceActionResult> {
  const access = await requireOfficeFinanceUser();
  if (!access.ok) {
    return { success: false, error: access.error };
  }
  const userId = access.userId;
  const admin = await requireFinanceAdmin();
  if (!admin.ok) {
    return { success: false, error: admin.error };
  }
  const parsed = setRecurringActiveSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join(" ") };
  }
  const existing = await prisma.recurringExpense.findFirst({
    where: { id: parsed.data.id, professionalUserId: userId },
    select: { id: true, frequency: true },
  });
  if (!existing) {
    return { success: false, error: "Despesa fixa não encontrada." };
  }
  const now = new Date();
  await prisma.recurringExpense.update({
    where: { id: parsed.data.id },
    data: {
      active: parsed.data.active,
      endedAt: parsed.data.active ? null : now,
    },
  });
  if (parsed.data.active) {
    await restoreDeactivatedRecurringTransactions({
      professionalUserId: userId,
      recurringExpenseId: parsed.data.id,
    });
    await materializeRecurringAroundNow({ professionalUserId: userId });
  } else {
    await voidRecurringTransactionsFromPeriod({
      professionalUserId: userId,
      recurringExpenseId: parsed.data.id,
      frequency: existing.frequency,
      fromUtc: now,
      reason: RECURRING_DEACTIVATED_VOID_REASON,
    });
  }
  revalidatePath("/dashboard/finances");
  return { success: true };
}

const deleteRecurringSchema = z.object({
  id: z.string().min(1),
});

/**
 * Remove o cadastro do gasto fixo e estorna todos os lançamentos automáticos
 * ainda ativos (histórico some de Analisar). Bloqueia se houver NFS-e emitida/em fila.
 */
export async function deleteRecurringExpense(
  input: unknown,
): Promise<ClinicFinanceActionResult> {
  const access = await requireOfficeFinanceUser();
  if (!access.ok) {
    return { success: false, error: access.error };
  }
  const userId = access.userId;
  const admin = await requireFinanceAdmin();
  if (!admin.ok) {
    return { success: false, error: admin.error };
  }
  const parsed = deleteRecurringSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join(" ") };
  }

  const existing = await prisma.recurringExpense.findFirst({
    where: { id: parsed.data.id, professionalUserId: userId },
    select: { id: true },
  });
  if (!existing) {
    return { success: false, error: "Despesa fixa não encontrada." };
  }

  const nfseBlocked = await prisma.financialTransaction.findFirst({
    where: {
      professionalUserId: userId,
      recurringExpenseId: parsed.data.id,
      source: FinancialEntrySource.RECURRING,
      voidedAt: null,
      fiscalDocument: { is: { status: { in: ["ISSUED", "QUEUED", "PROCESSING"] } } },
    },
    select: { id: true },
  });
  if (nfseBlocked) {
    return {
      success: false,
      error:
        "Não é possível excluir: há lançamento com NFS-e emitida ou em fila. Cancele a nota ou desative o gasto.",
    };
  }

  const now = new Date();
  await prisma.$transaction(async (db) => {
    await db.financialTransaction.updateMany({
      where: {
        professionalUserId: userId,
        recurringExpenseId: parsed.data.id,
        source: FinancialEntrySource.RECURRING,
        voidedAt: null,
      },
      data: {
        voidedAt: now,
        voidReason: RECURRING_DELETED_VOID_REASON,
      },
    });
    await db.recurringExpense.delete({ where: { id: parsed.data.id } });
  });

  revalidatePath("/dashboard/finances");
  return { success: true };
}

// ============================================================
// Relatório de período (bruto / despesa fixa / variável / líquido)
// ============================================================

export async function getFinancePeriodReport(
  input: unknown,
): Promise<ClinicFinanceActionResult<FinancePeriodReport>> {
  const admin = await requireFinanceAdmin();
  if (!admin.ok) {
    return { success: false, error: admin.error };
  }
  return getFinancePeriodReportForUser(admin.userId, input);
}

const consumeManualSchema = z.object({
  sessionId: z.string().min(1),
  consumedAt: z.coerce.date().optional(),
});

export async function consumeServiceSessionManual(
  input: unknown,
): Promise<
  ClinicFinanceActionResult<{
    sessionConsumption?: import("@/lib/finance/evolution-session-consumption").EvolutionSessionConsumptionSummary;
  }>
> {
  const access = await requirePatientServicesManage();
  if (!access.ok) {
    return { success: false, error: access.error };
  }
  const userId = access.userId;

  const role = await getFinanceAccessRole();
  if (role === "DENIED") {
    return { success: false, error: "Selecione o perfil profissional para continuar." };
  }

  const parsed = consumeManualSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join(" "),
    };
  }
  if (
    parsed.data.consumedAt &&
    parsed.data.consumedAt.getTime() > Date.now() + 24 * 60 * 60 * 1000
  ) {
    return { success: false, error: "A data da realização não pode estar no futuro." };
  }

  // Validação de escopo do paciente fora da tx curta; o claim PENDING
  // continua atómico (outra request concorrente falha no updateMany).
  let revalidatePatientId: string | null = null;
  const r = await consumeSessionManually(parsed.data.sessionId, userId, {
    consumedAt: parsed.data.consumedAt,
    assertPatientAccess: async (patientId) => {
      revalidatePatientId = patientId;
      if (patientId) {
        return assertPatientOwnedByProfessional(patientId, userId);
      }
      if (role === "MEMBER") {
        return {
          ok: false,
          error: "Acesso restrito: apenas administradores podem consumir esta sessão.",
        };
      }
      return { ok: true };
    },
  });
  if (!r.ok) {
    return { success: false, error: r.error };
  }

  const { loadEvolutionSessionConsumptionSummary } = await import(
    "@/lib/finance/evolution-session-consumption-load"
  );
  const { maybeNotifyPackageNearEndFromConsumption } = await import(
    "@/lib/push-notifications/dispatch"
  );
  const sessionConsumption = await loadEvolutionSessionConsumptionSummary(
    parsed.data.sessionId,
  );
  if (sessionConsumption?.consumed) {
    void maybeNotifyPackageNearEndFromConsumption({
      userId,
      summary: sessionConsumption,
    }).catch((err) =>
      console.error("[consumeServiceSessionManual] aviso fim de plano:", err),
    );
  }

  if (revalidatePatientId) {
    revalidatePath(`/dashboard/patients/${revalidatePatientId}`);
  }
  revalidatePath("/dashboard/finances");
  return { success: true, data: { sessionConsumption: sessionConsumption ?? undefined } };
}


const consumePurchaseSessionsByDatesSchema = z.object({
  purchaseId: z.string().min(1),
  dates: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (use yyyy-mm-dd)."))
    .min(1)
    .max(200),
});

/**
 * Baixa em lote sessões PENDING de uma compra existente nas datas informadas (áudio/UI).
 * Consome na ordem das datas; uma sessão PENDING por data.
 */
export async function consumePatientPurchaseSessionsByDates(
  input: unknown,
): Promise<ClinicFinanceActionResult<{ consumed: number; skipped: number }>> {
  const access = await requirePatientServicesManage();
  if (!access.ok) {
    return { success: false, error: access.error };
  }
  const userId = access.userId;

  const role = await getFinanceAccessRole();
  if (role === "DENIED") {
    return { success: false, error: "Selecione o perfil profissional para continuar." };
  }

  const parsed = consumePurchaseSessionsByDatesSchema.safeParse(input);
  if (!parsed.success) {
  return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join(" "),
    };
  }

  const uniqueDates = [...new Set(parsed.data.dates)].sort();
  for (const ymd of uniqueDates) {
    const at = yyyyMmDdToSaoPauloNoon(ymd) ?? new Date(`${ymd}T12:00:00-03:00`);
    if (at.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
      return { success: false, error: `A data ${ymd} não pode estar no futuro.` };
    }
  }

  const purchase = await prisma.patientServicePurchase.findFirst({
    where: { id: parsed.data.purchaseId, professionalUserId: userId },
    select: { id: true, patientId: true },
  });
  if (!purchase) {
    return { success: false, error: "Compra não encontrada." };
  }

  const own = await assertPatientOwnedByProfessional(purchase.patientId, userId);
  if (!own.ok) {
    return { success: false, error: own.error };
  }

  if (role === "MEMBER") {
    // MEMBER com canManagePatientServices já passou no gate requirePatientServicesManage.
  }

  const dates = uniqueDates.map(
    (ymd) => yyyyMmDdToSaoPauloNoon(ymd) ?? new Date(`${ymd}T12:00:00-03:00`),
  );
  const r = await consumePurchaseSessionsByDates({
    purchaseId: purchase.id,
    professionalUserId: userId,
    dates,
    assertPatientAccess: async (patientId) => {
      if (patientId) {
        return assertPatientOwnedByProfessional(patientId, userId);
      }
      if (role === "MEMBER") {
        return {
          ok: false,
          error: "Acesso restrito: apenas administradores podem consumir esta sessão.",
        };
      }
      return { ok: true };
    },
  });

  if (!r.ok) {
    return { success: false, error: r.error };
  }

  revalidatePath(`/dashboard/patients/${purchase.patientId}`);
  revalidatePath("/dashboard/finances");
  return { success: true, data: { consumed: r.consumed, skipped: r.skipped } };
}

const voidTxSchema = z.object({
  transactionId: z.string().min(1),
  reason: z.string().trim().min(3).max(500),
});

/**
 * Estorna um lançamento (soft void). ADMIN only.
 * Bloqueia se houver NFS-e emitida/em fila. Libera nova cobrança da compra.
 */
export async function voidFinancialTransaction(
  input: unknown,
): Promise<ClinicFinanceActionResult<{ id: string }>> {
  const admin = await requireFinanceAdmin();
  if (!admin.ok) return { success: false, error: admin.error };
  const userId = admin.userId;

  const parsed = voidTxSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join(" ") || "Dados inválidos.",
    };
  }

  // Transação: revalida NFS-e + limpa appointmentId (único) no mesmo write.
  try {
    const voided = await prisma.$transaction(async (db) => {
      const tx = await db.financialTransaction.findFirst({
        where: { id: parsed.data.transactionId, professionalUserId: userId },
    select: {
          id: true,
          voidedAt: true,
      patientId: true,
          appointmentId: true,
          fiscalDocument: { select: { status: true } },
        },
      });
      if (!tx) throw new Error("NOT_FOUND");
      if (tx.voidedAt) throw new Error("ALREADY_VOIDED");

      const nfse = tx.fiscalDocument?.status;
      if (nfse === "ISSUED" || nfse === "QUEUED" || nfse === "PROCESSING") {
        throw new Error("NFSE_BLOCK");
      }

      await db.financialTransaction.update({
        where: { id: tx.id },
        data: {
          voidedAt: new Date(),
          voidReason: sanitizeText(parsed.data.reason),
          // Libera o @unique appointmentId para nova receita na mesma marcação.
          appointmentId: null,
        },
      });
      return { id: tx.id, patientId: tx.patientId };
    });

    revalidatePath("/dashboard/finances");
    if (voided.patientId) revalidatePath(`/dashboard/patients/${voided.patientId}`);
    return { success: true, data: { id: voided.id } };
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    if (code === "NOT_FOUND") return { success: false, error: "Lançamento não encontrado." };
    if (code === "ALREADY_VOIDED") return { success: false, error: "Lançamento já estornado." };
    if (code === "NFSE_BLOCK") {
      return {
        success: false,
        error:
          "Há NFS-e ligada a esta receita. Cancele a nota fiscal antes de estornar o lançamento.",
      };
    }
    throw e;
  }
}

const updateTxMetaSchema = z.object({
  transactionId: z.string().min(1),
  description: z.string().max(2000).optional(),
  method: z.enum(["PIX", "CASH", "CARD", "TRANSFER", "OTHER"]).optional(),
  category: z.string().trim().max(120).optional(),
});

/**
 * Edição controlada: só metadados (descrição, método, categoria). Sem alterar valor.
 */
export async function updateFinancialTransactionMeta(
  input: unknown,
): Promise<ClinicFinanceActionResult<{ id: string }>> {
  const admin = await requireFinanceAdmin();
  if (!admin.ok) return { success: false, error: admin.error };
  const userId = admin.userId;

  const parsed = updateTxMetaSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Dados inválidos." };
  }
  if (
    parsed.data.description === undefined &&
    parsed.data.method === undefined &&
    parsed.data.category === undefined
  ) {
    return { success: false, error: "Nada para atualizar." };
  }

  const tx = await prisma.financialTransaction.findFirst({
    where: { id: parsed.data.transactionId, professionalUserId: userId, voidedAt: null },
    select: { id: true, patientId: true },
  });
  if (!tx) return { success: false, error: "Lançamento não encontrado." };

  await prisma.financialTransaction.update({
    where: { id: tx.id },
    data: {
      ...(parsed.data.description !== undefined
        ? { description: parsed.data.description ? sanitizeText(parsed.data.description) : null }
        : {}),
      ...(parsed.data.method ? { method: parsed.data.method as FinancialTransactionMethod } : {}),
      ...(parsed.data.category !== undefined
        ? { category: parsed.data.category ? sanitizeText(parsed.data.category) : null }
        : {}),
    },
  });

  revalidatePath("/dashboard/finances");
  if (tx.patientId) revalidatePath(`/dashboard/patients/${tx.patientId}`);
  return { success: true, data: { id: tx.id } };
}

const pendingPaymentsSchema = z.object({
  patientId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  serviceSpaceId: z.string().min(1).optional(),
});

/**
 * Compras sem entrada INCOME activa (pagamento pendente).
 * ADMIN: todos; MEMBER: só pacientes no escopo.
 */
export async function listPendingPaymentPurchases(
  input: unknown = {},
): Promise<
  ClinicFinanceActionResult<
    Array<{
      purchaseId: string;
      patientId: string;
      patientName: string;
      serviceName: string;
      agreedPriceCents: number;
      purchasedAt: Date;
      collectHref: string;
    }>
  >
> {
  const access = await requireOfficeFinanceUser();
  if (!access.ok) return { success: false, error: access.error };
  const userId = access.userId;
  const role = await getFinanceAccessRole();
  if (role === "DENIED") {
    return { success: false, error: PROFILE_REQUIRED_ERROR };
  }

  const parsed = pendingPaymentsSchema.safeParse(input ?? {});
  if (!parsed.success) return { success: false, error: "Filtro inválido." };
  const limit = parsed.data.limit ?? 40;

  let patientFilter: Prisma.PatientServicePurchaseWhereInput["patientId"] = undefined;
  if (parsed.data.patientId) {
    const own = await assertPatientOwnedByProfessional(parsed.data.patientId, userId);
    if (!own.ok) return { success: false, error: own.error };
    patientFilter = parsed.data.patientId;
  } else if (role === "MEMBER") {
    const scope = await getPatientAccessScope();
    if (!scope || scope.denied || !scope.activeIntraUser) {
      return { success: false, error: PROFILE_REQUIRED_ERROR };
    }
    const scoped = await prisma.patient.findMany({
      where: buildPatientScopeWhere({
        tenantId: scope.tenantId,
        activeIntraUser: scope.activeIntraUser,
      }),
      select: { id: true },
    });
    patientFilter = { in: scoped.map((p) => p.id) };
  }

  const spaceFilter = parseServiceSpaceViewParam(parsed.data.serviceSpaceId);
  const spaceClause = serviceSpaceWhere(spaceFilter, { includeGeneral: false });

  const purchases = await prisma.patientServicePurchase.findMany({
    where: {
      professionalUserId: userId,
      ...(patientFilter ? { patientId: patientFilter } : {}),
      ...(spaceClause ?? {}),
      transactions: {
        none: { kind: FinancialTransactionKind.INCOME, voidedAt: null },
      },
    },
    orderBy: { purchasedAt: "desc" },
    take: limit,
    select: {
      id: true,
      agreedPriceCents: true,
      purchasedAt: true,
      patientId: true,
      patient: { select: { name: true } },
      service: { select: { name: true } },
    },
  });

  return {
    success: true,
    data: purchases.map((p) => ({
      purchaseId: p.id,
      patientId: p.patientId,
      patientName: p.patient.name,
      serviceName: p.service.name,
      agreedPriceCents: p.agreedPriceCents,
      purchasedAt: p.purchasedAt,
      collectHref: buildFinanceDeepLink({
        tab: "analisar",
        patientId: p.patientId,
        purchaseId: p.id,
        action: "collect",
      }),
    })),
  };
}

const teamAttendanceSchema = z.object({
  start: z.coerce.date(),
  end: z.coerce.date(),
});

/**
 * Painel ADMIN (Consultório/Clínica): evoluções do período com profissional,
 * data, baixa de sessão e se fechou serviço/plano.
 */
export async function listTeamEvolutionAttendances(
  input: unknown,
): Promise<
  ClinicFinanceActionResult<{
    enabled: boolean;
    rows: TeamEvolutionAttendanceRow[];
  }>
> {
  const access = await requireFinanceAdmin();
  if (!access.ok) {
    return { success: false, error: access.error };
  }
  const ctx = await getIntraUserContext();
  if (!ctx) {
    return { success: false, error: "Não autenticado." };
  }
  if (!ctx.isClinica) {
    return { success: true, data: { enabled: false, rows: [] } };
  }

  const parsed = teamAttendanceSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Intervalo de datas inválido." };
  }
  const { start, end } = parsed.data;
  if (end.getTime() <= start.getTime()) {
    return { success: false, error: "Intervalo de datas inválido." };
  }

  const userId = access.userId;
  const evolutions = await prisma.evolution.findMany({
    where: {
      source: EvolutionSource.NATIVE,
      date: { gte: start, lte: end },
      patient: { userId, agendaOnly: false },
    },
    orderBy: { date: "desc" },
    take: 80,
    select: {
      id: true,
      date: true,
      attendingIntraUser: {
        select: { name: true, color: true, role: true },
      },
      appointment: {
        select: {
          intraUser: { select: { name: true, color: true, role: true } },
        },
      },
      patient: { select: { id: true, name: true } },
      sessionConsumptionEvents: {
        take: 1,
        select: {
          session: {
            select: {
              sequence: true,
              purchase: {
                select: {
                  sessionCountTotal: true,
                  type: true,
                  service: { select: { name: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  const saleKeys = evolutions.map((e) => `evolution-sale:${e.id}`);
  const sales =
    saleKeys.length === 0
      ? []
      : await prisma.patientServicePurchase.findMany({
          where: {
            professionalUserId: userId,
            idempotencyKey: { in: saleKeys },
          },
          select: {
            idempotencyKey: true,
            type: true,
            sessionCountTotal: true,
            agreedPriceCents: true,
            service: { select: { name: true } },
            transactions: {
              where: { kind: FinancialTransactionKind.INCOME, voidedAt: null },
              select: { id: true },
              take: 1,
            },
          },
        });
  const saleByEvolutionId = new Map(
    sales.map((s) => [s.idempotencyKey?.replace(/^evolution-sale:/, "") ?? "", s]),
  );

  const rows: TeamEvolutionAttendanceRow[] = evolutions.map((evo) => {
    const professional = evo.attendingIntraUser ?? evo.appointment?.intraUser ?? null;
    const consumption = evo.sessionConsumptionEvents[0]?.session ?? null;
    const sale = saleByEvolutionId.get(evo.id) ?? null;
    const sessionLabel = consumption
      ? `Sessão ${consumption.sequence} de ${consumption.purchase.sessionCountTotal} · ${consumption.purchase.service.name}`
      : null;
    const saleKind =
      sale?.type === PatientServicePurchaseType.PACKAGE
        ? `plano de ${sale.sessionCountTotal} sessões`
        : "serviço avulso";
    const saleLabel = sale ? `${sale.service.name} (${saleKind})` : null;

    return {
      evolutionId: evo.id,
      attendanceDateIso: evo.date.toISOString(),
      patientId: evo.patient.id,
      patientName: evo.patient.name,
      professionalName: professional?.name ?? "Não informado",
      professionalColor: professional?.color ?? null,
      professionalRole: professional?.role ?? null,
      sessionConsumed: Boolean(consumption),
      sessionLabel,
      saleClosed: Boolean(sale),
      saleLabel,
      salePaid: sale ? sale.transactions.length > 0 : null,
    };
  });

  return { success: true, data: { enabled: true, rows } };
}

// ============================================================
// Balanço dos Colaboradores (ADMIN · Consultório/Clínica)
// ============================================================

const collaboratorBalanceSchema = z.object({
  preset: z.enum(["WEEK", "FORTNIGHT", "MONTH"]),
  offset: z.coerce.number().int().min(-120).max(120).optional(),
  anchorIso: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export async function getCollaboratorBalanceReport(
  input: unknown,
): Promise<
  ClinicFinanceActionResult<{
    enabled: boolean;
    report: Awaited<ReturnType<typeof getCollaboratorBalanceReportForUser>> | null;
  }>
> {
  const admin = await requireFinanceAdmin();
  if (!admin.ok) return { success: false, error: admin.error };
  const ctx = await getIntraUserContext();
  if (!ctx?.isClinica) {
    return { success: true, data: { enabled: false, report: null } };
  }
  const parsed = collaboratorBalanceSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Período inválido." };
  }
  const { getCollaboratorBalanceReportForUser } = await import(
    "@/lib/finance/collaborator-balance-report"
  );
  const report = await getCollaboratorBalanceReportForUser(admin.userId, parsed.data);
  return { success: true, data: { enabled: true, report } };
}

const setCommissionSchema = z.object({
  intraUserId: z.string().min(1),
  commissionRateBps: z.number().int().min(0).max(10_000),
});

export async function setIntraUserCommissionRate(
  input: unknown,
): Promise<ClinicFinanceActionResult> {
  const admin = await requireFinanceAdmin();
  if (!admin.ok) return { success: false, error: admin.error };
  const ctx = await getIntraUserContext();
  if (!ctx?.isClinica || ctx.activeIntraUser?.role !== "ADMIN") {
    return { success: false, error: "Apenas administradores da equipe podem definir comissão." };
  }
  const parsed = setCommissionSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Comissão inválida (0% a 100%)." };
  }
  const { setIntraUserCommissionRateForTenant } = await import(
    "@/lib/finance/collaborator-balance-report"
  );
  const result = await setIntraUserCommissionRateForTenant({
    tenantId: admin.userId,
    intraUserId: parsed.data.intraUserId,
    commissionRateBps: parsed.data.commissionRateBps,
  });
  if (!result.ok) return { success: false, error: result.error };
  revalidatePath("/dashboard/finances");
  revalidatePath("/dashboard/profile");
  return { success: true };
}

const recordPayoutSchema = z.object({
  intraUserId: z.string().min(1),
  amountCents: z.number().int().positive().max(50_000_000),
  method: z.nativeEnum(FinancialTransactionMethod),
  preset: z.enum(["WEEK", "FORTNIGHT", "MONTH"]),
  offset: z.coerce.number().int().min(-120).max(120).optional(),
  anchorIso: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function recordCollaboratorPayout(
  input: unknown,
): Promise<
  ClinicFinanceActionResult<{
    payoutId: string;
    transactionId: string;
    balanceAfterCents: number;
  }>
> {
  const admin = await requireFinanceAdmin();
  if (!admin.ok) return { success: false, error: admin.error };
  const ctx = await getIntraUserContext();
  if (!ctx?.isClinica || ctx.activeIntraUser?.role !== "ADMIN") {
    return { success: false, error: "Apenas administradores da equipe podem registrar repasse." };
  }
  const parsed = recordPayoutSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join(" ") || "Dados inválidos.",
    };
  }
  const { recordCollaboratorPayoutForTenant } = await import(
    "@/lib/finance/collaborator-balance-report"
  );
  const result = await recordCollaboratorPayoutForTenant({
    tenantId: admin.userId,
    intraUserId: parsed.data.intraUserId,
    amountCents: parsed.data.amountCents,
    method: parsed.data.method,
    period: parsed.data.preset,
    offset: parsed.data.offset,
    anchorIso: parsed.data.anchorIso,
    notes: parsed.data.notes,
  });
  if (!result.ok) return { success: false, error: result.error };
  revalidatePath("/dashboard/finances");
  return {
    success: true,
    data: {
      payoutId: result.payoutId,
      transactionId: result.transactionId,
      balanceAfterCents: result.balanceAfterCents,
    },
  };
}

const voidPayoutSchema = z.object({
  payoutId: z.string().min(1),
  reason: z.string().trim().min(3).max(500).optional(),
});

export async function voidCollaboratorPayout(
  input: unknown,
): Promise<ClinicFinanceActionResult> {
  const admin = await requireFinanceAdmin();
  if (!admin.ok) return { success: false, error: admin.error };
  const ctx = await getIntraUserContext();
  if (!ctx?.isClinica || ctx.activeIntraUser?.role !== "ADMIN") {
    return { success: false, error: "Apenas administradores podem estornar repasse." };
  }
  const parsed = voidPayoutSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Repasse inválido." };
  }
  const { voidCollaboratorPayoutForTenant } = await import(
    "@/lib/finance/collaborator-balance-report"
  );
  const result = await voidCollaboratorPayoutForTenant({
    tenantId: admin.userId,
    payoutId: parsed.data.payoutId,
    reason: parsed.data.reason,
  });
  if (!result.ok) return { success: false, error: result.error };
  revalidatePath("/dashboard/finances");
  return { success: true };
}

const payAllSchema = z.object({
  method: z.nativeEnum(FinancialTransactionMethod),
  preset: z.enum(["WEEK", "FORTNIGHT", "MONTH"]),
  offset: z.coerce.number().int().min(-120).max(120).optional(),
  anchorIso: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export async function recordCollaboratorPayoutBatch(
  input: unknown,
): Promise<
  ClinicFinanceActionResult<{ paidCount: number; totalCents: number }>
> {
  const admin = await requireFinanceAdmin();
  if (!admin.ok) return { success: false, error: admin.error };
  const ctx = await getIntraUserContext();
  if (!ctx?.isClinica || ctx.activeIntraUser?.role !== "ADMIN") {
    return { success: false, error: "Apenas administradores podem registrar repasse em lote." };
  }
  const parsed = payAllSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Dados inválidos para pagar todos." };
  }
  const { recordCollaboratorPayoutBatchForTenant } = await import(
    "@/lib/finance/collaborator-balance-report"
  );
  const result = await recordCollaboratorPayoutBatchForTenant({
    tenantId: admin.userId,
    method: parsed.data.method,
    period: parsed.data.preset,
    offset: parsed.data.offset,
    anchorIso: parsed.data.anchorIso,
  });
  if (!result.ok) return { success: false, error: result.error };
  revalidatePath("/dashboard/finances");
  return {
    success: true,
    data: { paidCount: result.paidCount, totalCents: result.totalCents },
  };
}

export async function getCollaboratorBalanceDueSummary(): Promise<
  ClinicFinanceActionResult<{ enabled: boolean; balanceCents: number; dueCount: number }>
> {
  const admin = await requireFinanceAdmin();
  if (!admin.ok) return { success: false, error: admin.error };
  const ctx = await getIntraUserContext();
  if (!ctx?.isClinica) {
    return { success: true, data: { enabled: false, balanceCents: 0, dueCount: 0 } };
  }
  const { getCollaboratorBalanceDueSummaryForUser } = await import(
    "@/lib/finance/collaborator-balance-report"
  );
  const summary = await getCollaboratorBalanceDueSummaryForUser(admin.userId);
  return {
    success: true,
    data: { enabled: true, ...summary },
  };
}
