import { AppointmentSource, AppointmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { ActiveIntraUser } from "@/lib/intra-user/patient-scope";
import { appointmentPatientDisplayName } from "@/lib/patient-clinical-scope";
import {
  DEFAULT_SCHEDULE_TIMEZONE,
  resolveAppointmentWindow,
} from "@/lib/schedule-temporal-parse";
import { resolveTimeOfDayMinutes } from "@/lib/schedule-time-expression";
import {
  formatSlotLabel,
  resolveRescheduleTarget,
  selectAppointmentForCommand,
  type DayWindow,
} from "@/lib/scheduling-appointment-match";
import {
  planSchedulingCommands,
  resolveNoShowReason,
  type SchedulingPlan,
} from "@/lib/scheduling-command-plan";
import {
  bookAppointmentsFromItems,
  normalizePatientName,
  resolvePatientFromGuess,
  resolveSlotFromIntentItem,
  type BookedAppointment,
  type BookingIssue,
  type PatientRef,
} from "@/lib/scheduling-booking";
import type { CatalogServiceRef } from "@/lib/appointment-service-resolve";
import type { SchedulingIntentItem, SchedulingModelOutput } from "@/lib/scheduling-intent-schema";
import {
  cancelAppointmentForUser,
  updateAppointmentForUser,
} from "@/server/services/appointments";
import { activateYieldOnFreedWindow } from "@/lib/marketplace/native-agenda-lock";
import type { ResourceRef } from "@/lib/marketplace/resolve-resource-name";

/** Janela consultada para localizar marcações existentes referidas por voz. */
const LOOKBACK_DAYS = 90;
const LOOKAHEAD_DAYS = 365;

export type RescheduledAppointment = {
  id: string;
  patientName: string;
  previousStartAt: Date;
  startAt: Date;
  endAt: Date;
};

export type CancelledAppointment = {
  id: string;
  patientName: string;
  startAt: Date;
};

export type RenamedAppointment = {
  id: string;
  previousName: string;
  patientName: string;
  startAt: Date;
};

export type NoShowAppointment = {
  id: string;
  patientName: string;
  startAt: Date;
  noShowReason: string;
};

export type SchedulingIntentOutcome = {
  plan: SchedulingPlan;
  created: BookedAppointment[];
  rescheduled: RescheduledAppointment[];
  cancelled: CancelledAppointment[];
  renamed: RenamedAppointment[];
  noShows: NoShowAppointment[];
  errors: string[];
  issues: BookingIssue[];
  newPatientNames: string[];
};

type ActiveAppointmentRow = {
  id: string;
  startAt: Date;
  endAt: Date;
  timezoneAtBooking: string;
  patientId: string;
  patientName: string;
  status: AppointmentStatus;
};

/**
 * Mesma segregação de `cancelAppointmentForUser`: MEMBER só alcança marcações
 * em que atende ou de pacientes próprios/compartilhados.
 */
function memberScopeWhere(activeIntraUser: ActiveIntraUser | null) {
  if (!activeIntraUser || activeIntraUser.role !== "MEMBER") return {};
  return {
    OR: [
      { intraUserId: activeIntraUser.id },
      { patient: { OR: [{ ownerId: activeIntraUser.id }, { isShared: true }] } },
    ],
  };
}

/**
 * Marcações elegíveis a remarcar/desmarcar/falta por voz na janela útil.
 * Inclui SCHEDULED e COMPLETED (ex.: "desmarque a Ana de segunda" após
 * realizada — só sai da agenda; sessão/financeiro ficam). CANCELLED/NO_SHOW
 * ficam fora. Falta justificada só aplica em SCHEDULED (filtrado no apply).
 * Inclui pacientes `agendaOnly`, que não aparecem na lista clínica.
 */
async function loadActiveAppointments(
  professionalUserId: string,
  activeIntraUser: ActiveIntraUser | null,
  now: Date,
): Promise<ActiveAppointmentRow[]> {
  const from = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

  const rows = await prisma.appointment.findMany({
    where: {
      professionalUserId,
      status: {
        in: [AppointmentStatus.SCHEDULED, AppointmentStatus.COMPLETED],
      },
      startAt: { gte: from, lte: to },
      ...memberScopeWhere(activeIntraUser),
    },
    orderBy: { startAt: "asc" },
    select: {
      id: true,
      startAt: true,
      endAt: true,
      timezoneAtBooking: true,
      patientId: true,
      title: true,
      source: true,
      status: true,
      patient: { select: { name: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    startAt: r.startAt,
    endAt: r.endAt,
    timezoneAtBooking: r.timezoneAtBooking,
    patientId: r.patientId,
    status: r.status,
    // GOOGLE_SYNC: o card mostra o título ("FECHADO"), não o placeholder.
    patientName: appointmentPatientDisplayName({
      source: r.source,
      title: r.title,
      patientName: r.patient.name,
    }),
  }));
}

function distinctPatients(rows: ActiveAppointmentRow[]): PatientRef[] {
  // Um placeholder Google pode ter vários títulos → várias entradas com o mesmo id.
  const seen = new Set<string>();
  const out: PatientRef[] = [];
  for (const row of rows) {
    const key = `${row.patientId}::${normalizePatientName(row.patientName)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: row.patientId, name: row.patientName });
  }
  return out;
}

type TargetResolution =
  | {
      ok: true;
      row: ActiveAppointmentRow;
      patientName: string;
      timezone: string;
    }
  | { ok: false; error: string };

/**
 * Localiza a marcação existente visada pelo item. Nunca cria paciente:
 * remarcar/desmarcar só operam sobre quem já está na agenda.
 */
function resolveTargetAppointment(params: {
  item: SchedulingIntentItem;
  rows: ActiveAppointmentRow[];
  patients: PatientRef[];
  now: Date;
  fallbackTimezone: string;
}): TargetResolution {
  const { item, rows, patients, now, fallbackTimezone } = params;
  const nameGuess = item.patientNameGuess?.trim() ?? "";

  const patient = resolvePatientFromGuess(nameGuess, patients);
  if (!patient) {
    return {
      ok: false,
      error: `Não encontrei "${nameGuess}" com marcação ativa na agenda.`,
    };
  }

  const guessNorm = normalizePatientName(nameGuess);
  let patientRows = rows.filter((r) => r.patientId === patient.id);
  // Se o chute casou com o título do card (ex.: FECHADO), restringe a esses slots.
  const namedRows = patientRows.filter(
    (r) => normalizePatientName(r.patientName) === guessNorm,
  );
  if (namedRows.length > 0) {
    patientRows = namedRows;
  }
  const timezone = patientRows[0]?.timezoneAtBooking || fallbackTimezone;

  let dayWindow: DayWindow | null = null;
  let dayLabel: string | null = null;
  const dateExpr = item.dateExpression?.trim();
  if (dateExpr) {
    const window = resolveAppointmentWindow(dateExpr, now, timezone);
    if (!window.ok) {
      return { ok: false, error: `${patient.name}: ${window.message}` };
    }
    dayWindow = { startUtc: window.startUtc, endUtc: window.endUtc };
    dayLabel = window.label;
  }

  // A hora dita desempata mesmo sem dia ("desmarque a Ana das 14h").
  const targetTimeOfDayMinutes = resolveTimeOfDayMinutes(item.timeExpression);

  const selection = selectAppointmentForCommand({
    patientName: patient.name,
    appointments: patientRows,
    dayWindow,
    dayLabel,
    targetTimeOfDayMinutes,
    now,
    timezone,
  });

  if (!selection.ok) {
    return { ok: false, error: selection.error };
  }

  const row = patientRows.find((r) => r.id === selection.appointment.id)!;
  return { ok: true, row, patientName: patient.name, timezone };
}

/**
 * Aplica um plano de comandos de agenda (criar / remarcar / desmarcar / falta).
 * Conflito de horário, push para o Google e efeitos financeiros continuam
 * a cargo dos serviços de marcação — aqui só se resolve o alvo.
 */
export async function applySchedulingIntent(params: {
  professionalUserId: string;
  /** Lista clínica, usada apenas na criação (pode criar placeholder `agendaOnly`). */
  patients: PatientRef[];
  model: SchedulingModelOutput;
  source: AppointmentSource;
  catalogServices?: CatalogServiceRef[];
  resources?: ResourceRef[];
  activeIntraUser: ActiveIntraUser | null;
  timezone?: string;
  now?: Date;
}): Promise<SchedulingIntentOutcome> {
  const {
    professionalUserId,
    patients,
    model,
    source,
    catalogServices = [],
    resources = [],
    activeIntraUser,
  } = params;
  const tz = params.timezone ?? DEFAULT_SCHEDULE_TIMEZONE;
  const now = params.now ?? new Date();

  const plan = planSchedulingCommands(model);
  const outcome: SchedulingIntentOutcome = {
    plan,
    created: [],
    rescheduled: [],
    cancelled: [],
    renamed: [],
    noShows: [],
    errors: [],
    issues: [],
    newPatientNames: [],
  };

  if (plan.create.length > 0) {
    const booked = await bookAppointmentsFromItems({
      professionalUserId,
      patients,
      items: plan.create,
      source,
      timezoneAtBooking: tz,
      catalogServices,
      resources,
    });
    outcome.created.push(...booked.created);
    outcome.errors.push(...booked.errors);
    outcome.issues.push(...booked.issues);
    outcome.newPatientNames.push(...booked.newPatientNames);
  }

  if (plan.yield.length > 0) {
    for (const item of plan.yield) {
      const slotRes = resolveSlotFromIntentItem(item, now, tz, {
        requireExplicitTime: true,
      });
      if (!slotRes.ok) {
        outcome.errors.push(slotRes.error);
        continue;
      }
      if (!item.discountYield) {
        outcome.errors.push("Informe o percentual de desconto para o horário vago.");
        continue;
      }
      await activateYieldOnFreedWindow(
        professionalUserId,
        slotRes.slot.startUtc,
        slotRes.slot.endUtc,
        item.discountYield,
      );
    }
  }

  const needsExisting =
    plan.reschedule.length > 0 ||
    plan.cancel.length > 0 ||
    plan.rename.length > 0 ||
    plan.noShow.length > 0;
  if (!needsExisting) return outcome;

  let rows = await loadActiveAppointments(professionalUserId, activeIntraUser, now);
  const knownPatients = distinctPatients(rows);

  for (const item of plan.reschedule) {
    const target = resolveTargetAppointment({
      item,
      rows,
      patients: knownPatients,
      now,
      fallbackTimezone: tz,
    });
    if (!target.ok) {
      outcome.errors.push(target.error);
      continue;
    }

    let newDayWindow: DayWindow | null = null;
    const newDateExpr = item.newDateExpression?.trim();
    if (newDateExpr) {
      const window = resolveAppointmentWindow(newDateExpr, now, target.timezone);
      if (!window.ok) {
        outcome.errors.push(`${target.patientName}: ${window.message}`);
        continue;
      }
      newDayWindow = { startUtc: window.startUtc, endUtc: window.endUtc };
    }

    const destination = resolveRescheduleTarget({
      current: target.row,
      newDayWindow,
      newTimeExpression: item.newTimeExpression,
      timezone: target.timezone,
    });
    if (!destination.ok) {
      outcome.errors.push(`${target.patientName}: ${destination.error}`);
      continue;
    }

    const res = await updateAppointmentForUser(
      professionalUserId,
      {
        appointmentId: target.row.id,
        startAt: destination.startUtc,
        endAt: destination.endUtc,
      },
      { activeIntraUser },
    );

    if (!res.success) {
      outcome.errors.push(
        `${target.patientName} (${formatSlotLabel(target.row.startAt, target.timezone)}): ${res.error}`,
      );
      if (res.suggestedSlots?.length) {
        outcome.issues.push({
          message: `Horário indisponível para ${target.patientName} em ${destination.label}.`,
          suggestedSlots: res.suggestedSlots,
        });
      }
      continue;
    }

    outcome.rescheduled.push({
      id: target.row.id,
      patientName: target.patientName,
      previousStartAt: target.row.startAt,
      startAt: destination.startUtc,
      endAt: destination.endUtc,
    });

    // O slot mudou: reflete em memória para o próximo item do mesmo áudio.
    rows = rows.map((r) =>
      r.id === target.row.id
        ? { ...r, startAt: destination.startUtc, endAt: destination.endUtc }
        : r,
    );
  }

  for (const item of plan.cancel) {
    const target = resolveTargetAppointment({
      item,
      rows,
      patients: knownPatients,
      now,
      fallbackTimezone: tz,
    });
    if (!target.ok) {
      outcome.errors.push(target.error);
      continue;
    }

    const res = await cancelAppointmentForUser(
      professionalUserId,
      { appointmentId: target.row.id },
      activeIntraUser,
    );
    if (!res.success) {
      outcome.errors.push(`${target.patientName}: ${res.error}`);
      continue;
    }

    outcome.cancelled.push({
      id: target.row.id,
      patientName: target.patientName,
      startAt: target.row.startAt,
    });

    if (item.discountYield) {
      await activateYieldOnFreedWindow(
        professionalUserId,
        target.row.startAt,
        target.row.endAt,
        item.discountYield,
      );
    }

    // Já desmarcada: sai da lista para não ser alvo de outro item do mesmo áudio.
    rows = rows.filter((r) => r.id !== target.row.id);
  }

  for (const item of plan.rename) {
    const target = resolveTargetAppointment({
      item,
      rows,
      patients: knownPatients,
      now,
      fallbackTimezone: tz,
    });
    if (!target.ok) {
      outcome.errors.push(target.error);
      continue;
    }

    const nextName =
      item.newPatientNameGuess?.trim() || item.title?.trim() || "";
    if (nextName.length < 2) {
      outcome.errors.push(`${target.patientName}: novo nome não identificado.`);
      continue;
    }

    const res = await updateAppointmentForUser(
      professionalUserId,
      {
        appointmentId: target.row.id,
        newPatientName: nextName,
      },
      { activeIntraUser },
    );
    if (!res.success) {
      outcome.errors.push(`${target.patientName}: ${res.error}`);
      continue;
    }

    outcome.renamed.push({
      id: target.row.id,
      previousName: target.patientName,
      patientName: nextName,
      startAt: target.row.startAt,
    });

    rows = rows.map((r) =>
      r.id === target.row.id ? { ...r, patientName: nextName } : r,
    );
    // Atualiza o rótulo em memória (mesmo patientId) — não duplicar entradas.
    const oldNorm = normalizePatientName(target.patientName);
    const nextNorm = normalizePatientName(nextName);
    const knownIdx = knownPatients.findIndex(
      (p) => p.id === target.row.patientId && normalizePatientName(p.name) === oldNorm,
    );
    if (knownIdx >= 0) {
      knownPatients[knownIdx] = { id: target.row.patientId, name: nextName };
    } else if (
      !knownPatients.some(
        (p) => p.id === target.row.patientId && normalizePatientName(p.name) === nextNorm,
      )
    ) {
      knownPatients.push({ id: target.row.patientId, name: nextName });
    }
  }

  for (const item of plan.noShow) {
    const reason = resolveNoShowReason(item);
    if (reason.length < 3) {
      outcome.errors.push(
        "Informe a justificativa da falta (mínimo 3 caracteres).",
      );
      continue;
    }

    // Falta só em SCHEDULED — COMPLETED já compareceu.
    const scheduledRows = rows.filter((r) => r.status === AppointmentStatus.SCHEDULED);
    const target = resolveTargetAppointment({
      item,
      rows: scheduledRows,
      patients: knownPatients,
      now,
      fallbackTimezone: tz,
    });
    if (!target.ok) {
      outcome.errors.push(target.error);
      continue;
    }

    const res = await updateAppointmentForUser(
      professionalUserId,
      {
        appointmentId: target.row.id,
        status: AppointmentStatus.NO_SHOW,
        noShowReason: reason,
      },
      { activeIntraUser },
    );
    if (!res.success) {
      outcome.errors.push(`${target.patientName}: ${res.error}`);
      continue;
    }

    outcome.noShows.push({
      id: target.row.id,
      patientName: target.patientName,
      startAt: target.row.startAt,
      noShowReason: reason,
    });

    rows = rows.filter((r) => r.id !== target.row.id);
  }

  if (outcome.errors.length > 0) {
    logger.info("Comandos de agenda por voz com erros", {
      professionalUserId,
      action: plan.action,
      errorCount: outcome.errors.length,
    });
  }

  return outcome;
}
