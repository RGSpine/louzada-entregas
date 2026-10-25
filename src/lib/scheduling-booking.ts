import { DateTime } from "luxon";
import {
  AppointmentCareSetting,
  AppointmentSource,
  AppointmentVisitKind,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import {
  findAppointmentOverlap,
  findResourceCapacityOverlap,
} from "@/lib/appointment-availability";
import { scheduleGoogleCalendarPush } from "@/lib/google-calendar-push";
import {
  MARKETPLACE_SLOT_TAKEN_BY_PATIENT,
  RESOURCE_AT_CAPACITY,
  blockYieldSlotsForNativeAppointment,
  findMarketplaceBookedOverlap,
  withAgendaYieldTransaction,
} from "@/lib/marketplace/native-agenda-lock";
import { resolveResourceFromGuess, type ResourceRef } from "@/lib/marketplace/resolve-resource-name";
import { resolveCatalogServiceForAppointment } from "@/lib/appointment-service-resolve";
import type { CatalogServiceRef } from "@/lib/appointment-service-resolve";
import { resolveTreatmentPlanSessionForAppointment } from "@/lib/appointment-plan-session";
import { resolveConfirmationStatusFromGuess } from "@/lib/appointment-confirmation";
import {
  formatSuggestedSlotsMessage,
  suggestAlternativeSlots,
  type SuggestedSlot,
} from "@/lib/appointment-suggested-slots";
import {
  DEFAULT_SCHEDULE_TIMEZONE,
  resolveAppointmentWindow,
} from "@/lib/schedule-temporal-parse";
import { resolveTimeOnDay } from "@/lib/schedule-time-expression";
import { expandCreateItemsMultiDay } from "@/lib/scheduling-command-plan";
import type { SchedulingIntentItem } from "@/lib/scheduling-intent-schema";

export { resolveTimeOnDay };

export type PatientRef = { id: string; name: string };

export function normalizePatientName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve paciente pela lista clínica ou cria placeholder `agendaOnly`.
 * Marcações NÃO criam ficha clínica — isso só ocorre em rotas de evolução.
 * Atualiza `patients` em memória quando reutiliza/cria placeholder no mesmo lote.
 */
export async function resolveOrCreatePatientForBooking(params: {
  professionalUserId: string;
  nameGuess: string | null | undefined;
  patients: PatientRef[];
}): Promise<
  { ok: true; patient: PatientRef; createdNew: boolean } | { ok: false; error: string }
> {
  const matched = resolvePatientFromGuess(params.nameGuess, params.patients);
  if (matched) {
    return { ok: true, patient: matched, createdNew: false };
  }

  const raw = params.nameGuess?.trim();
  if (!raw || raw.length < 2) {
    return { ok: false, error: "Nome do paciente não identificado no pedido." };
  }

  const name = sanitizeText(raw);
  if (name.length < 2) {
    return { ok: false, error: "Nome do paciente inválido." };
  }

  const clinical = await prisma.patient.findFirst({
    where: {
      userId: params.professionalUserId,
      agendaOnly: false,
      name: { equals: name, mode: "insensitive" },
    },
    select: { id: true, name: true },
  });

  if (clinical) {
    const ref = { id: clinical.id, name: clinical.name };
    if (!params.patients.some((p) => p.id === ref.id)) {
      params.patients.push(ref);
    }
    return { ok: true, patient: ref, createdNew: false };
  }

  const existingAgenda = await prisma.patient.findFirst({
    where: {
      userId: params.professionalUserId,
      agendaOnly: true,
      name: { equals: name, mode: "insensitive" },
    },
    select: { id: true, name: true },
  });

  if (existingAgenda) {
    return {
      ok: true,
      patient: { id: existingAgenda.id, name: existingAgenda.name },
      createdNew: false,
    };
  }

  const created = await prisma.patient.create({
    data: {
      name,
      userId: params.professionalUserId,
      agendaOnly: true,
    },
    select: { id: true, name: true },
  });
  return {
    ok: true,
    patient: { id: created.id, name: created.name },
    createdNew: true,
  };
}

export function resolvePatientFromGuess(
  guess: string | null | undefined,
  patients: PatientRef[],
): PatientRef | null {
  if (!guess || patients.length === 0) return null;
  const g = normalizePatientName(guess);
  if (!g) return null;
  for (const p of patients) {
    const n = normalizePatientName(p.name);
    if (n === g || n.includes(g) || g.includes(n)) {
      return p;
    }
  }
  const tokens = g.split(" ").filter((t) => t.length > 2);
  let best: (PatientRef & { score: number }) | null = null;
  for (const p of patients) {
    const n = normalizePatientName(p.name);
    let score = 0;
    for (const t of tokens) {
      if (n.includes(t)) score += t.length;
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { ...p, score };
    }
  }
  return best ? { id: best.id, name: best.name } : null;
}

export type ResolvedSlot = {
  startUtc: Date;
  endUtc: Date;
  label: string;
};

export function resolveSlotFromIntentItem(
  item: SchedulingIntentItem,
  now: Date,
  tz: string = DEFAULT_SCHEDULE_TIMEZONE,
  options?: { requireExplicitTime?: boolean },
): { ok: true; slot: ResolvedSlot } | { ok: false; error: string } {
  const dateExpr = item.dateExpression?.trim();
  if (!dateExpr) {
    return { ok: false, error: "Data não identificada (ex.: amanhã, próxima quinta)." };
  }

  if (options?.requireExplicitTime && !item.timeExpression?.trim()) {
    return {
      ok: false,
      error: "Horário obrigatório no áudio (ex.: às 16h). O formulário manual não influencia esta marcação.",
    };
  }

  const window = resolveAppointmentWindow(dateExpr, now, tz);
  if (!window.ok) {
    return { ok: false, error: window.message };
  }

  const dayLocal = DateTime.fromJSDate(window.startUtc, { zone: "utc" }).setZone(tz).startOf("day");
  const timeRes = resolveTimeOnDay(dayLocal, item.timeExpression);
  if (!timeRes.ok) {
    return { ok: false, error: timeRes.error };
  }
  const startLocal = timeRes.at;
  const minutes = item.durationMinutes && item.durationMinutes > 0 ? item.durationMinutes : 60;
  const endLocal = startLocal.plus({ minutes });

  return {
    ok: true,
    slot: {
      startUtc: startLocal.toUTC().toJSDate(),
      endUtc: endLocal.toUTC().toJSDate(),
      label: `${startLocal.toFormat("dd/LL/yyyy HH:mm")} (${minutes} min)`,
    },
  };
}

export type BookedAppointment = {
  id: string;
  patientName: string;
  startAt: Date;
  endAt: Date;
};

export type BookingIssue = {
  message: string;
  suggestedSlots?: SuggestedSlot[];
};

export async function bookAppointmentsFromItems(params: {
  professionalUserId: string;
  patients: PatientRef[];
  items: SchedulingIntentItem[];
  source: AppointmentSource;
  timezoneAtBooking?: string;
  catalogServices?: CatalogServiceRef[];
  resources?: ResourceRef[];
}): Promise<{
  created: BookedAppointment[];
  errors: string[];
  issues: BookingIssue[];
  newPatientNames: string[];
}> {
  const tz = params.timezoneAtBooking ?? DEFAULT_SCHEDULE_TIMEZONE;
  const now = new Date();
  const catalogServices = params.catalogServices ?? [];
  const resources = params.resources ?? [];
  const created: BookedAppointment[] = [];
  const errors: string[] = [];
  const issues: BookingIssue[] = [];
  const newPatientNames: string[] = [];
  // Rede de segurança: create com "terça e quinta" / "próximas N segundas"
  // ainda cria N slots se o planner não tiver expandido antes.
  const items = expandCreateItemsMultiDay(params.items, now, tz);

  for (const item of items) {
    const patientRes = await resolveOrCreatePatientForBooking({
      professionalUserId: params.professionalUserId,
      nameGuess: item.patientNameGuess,
      patients: params.patients,
    });
    if (!patientRes.ok) {
      errors.push(patientRes.error);
      continue;
    }
    const patient = patientRes.patient;
    if (patientRes.createdNew) {
      newPatientNames.push(patient.name);
    }

    const requireExplicitTime =
      params.source === AppointmentSource.VOICE || params.source === AppointmentSource.OCR;
    const slotRes = resolveSlotFromIntentItem(item, now, tz, { requireExplicitTime });
    if (!slotRes.ok) {
      errors.push(slotRes.error);
      continue;
    }

    const overlap = await findAppointmentOverlap(
      params.professionalUserId,
      slotRes.slot.startUtc,
      slotRes.slot.endUtc,
    );
    if (overlap.overlapping) {
      const minutes =
        item.durationMinutes && item.durationMinutes > 0 ? item.durationMinutes : 60;
      const suggestions = await suggestAlternativeSlots({
        professionalUserId: params.professionalUserId,
        preferredStartUtc: slotRes.slot.startUtc,
        durationMinutes: minutes,
        timezone: tz,
      });
      const base = `Horário indisponível para ${patient.name} (${slotRes.slot.label}) — conflito com outra marcação.`;
      const msg = base + formatSuggestedSlotsMessage(suggestions);
      errors.push(msg);
      issues.push({ message: base, suggestedSlots: suggestions });
      continue;
    }

    const visitKind = item.visitKind ?? AppointmentVisitKind.UNIQUE_CONSULTATION;
    const careSetting = item.careSetting ?? AppointmentCareSetting.IN_PERSON_CLINIC;

    const catalogMatch = resolveCatalogServiceForAppointment({
      serviceNameGuess: item.serviceNameGuess,
      priceCents: item.priceCents,
      services: catalogServices,
    });

    const planRes = await resolveTreatmentPlanSessionForAppointment({
      professionalUserId: params.professionalUserId,
      patientId: patient.id,
      visitKind,
    });
    if (!planRes.ok) {
      errors.push(`${patient.name}: ${planRes.error}`);
      continue;
    }

    const priceCents =
      item.priceCents !== undefined && item.priceCents !== null
        ? item.priceCents
        : visitKind === AppointmentVisitKind.TREATMENT_PLAN
          ? planRes.priceCents
          : catalogMatch && catalogMatch.defaultPriceCents > 0
            ? catalogMatch.defaultPriceCents
            : null;

    const professionalServiceId =
      visitKind === AppointmentVisitKind.TREATMENT_PLAN && planRes.professionalServiceId
        ? planRes.professionalServiceId
        : (catalogMatch?.id ?? null);

    const guessedSpace = resolveResourceFromGuess(item.resourceNameGuess, resources);
    const serviceSpaceId =
      guessedSpace?.id ??
      (visitKind === AppointmentVisitKind.TREATMENT_PLAN
        ? (planRes.serviceSpaceId ?? null)
        : (catalogMatch?.serviceSpaceId ?? null));

    const notes = item.notes ? sanitizeText(item.notes) : null;

    try {
      const row = await withAgendaYieldTransaction(async (tx) => {
        const market = await findMarketplaceBookedOverlap(
          tx,
          params.professionalUserId,
          slotRes.slot.startUtc,
          slotRes.slot.endUtc,
        );
        if (market.overlapping) {
          throw new Error(MARKETPLACE_SLOT_TAKEN_BY_PATIENT);
        }
        if (serviceSpaceId) {
          const resource = await findResourceCapacityOverlap(
            params.professionalUserId,
            serviceSpaceId,
            slotRes.slot.startUtc,
            slotRes.slot.endUtc,
            { client: tx },
          );
          if (resource.overlapping) {
            throw new Error(RESOURCE_AT_CAPACITY);
          }
        }
        const createdRow = await tx.appointment.create({
          data: {
            professionalUserId: params.professionalUserId,
            patientId: patient.id,
            startAt: slotRes.slot.startUtc,
            endAt: slotRes.slot.endUtc,
            timezoneAtBooking: tz,
            source: params.source,
            title: item.title ? sanitizeText(item.title) : null,
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
            confirmationStatus: resolveConfirmationStatusFromGuess(item.confirmationStatus),
          },
          select: {
            id: true,
            startAt: true,
            endAt: true,
            patient: { select: { name: true } },
          },
        });
        await blockYieldSlotsForNativeAppointment(tx, {
          professionalUserId: params.professionalUserId,
          appointmentId: createdRow.id,
          startAt: slotRes.slot.startUtc,
          endAt: slotRes.slot.endUtc,
          serviceSpaceId,
          priceCents,
        });
        return createdRow;
      });

      created.push({
        id: row.id,
        patientName: row.patient.name,
        startAt: row.startAt,
        endAt: row.endAt,
      });

      scheduleGoogleCalendarPush(params.professionalUserId, row.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao marcar.";
      errors.push(`${patient.name}: ${message}`);
    }
  }

  return { created, errors, issues, newPatientNames };
}
