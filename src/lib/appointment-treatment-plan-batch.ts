import { DateTime } from "luxon";
import {
  AppointmentCareSetting,
  AppointmentConfirmationStatus,
  AppointmentSource,
  AppointmentStatus,
  AppointmentVisitKind,
  PatientServiceSessionStatus,
} from "@prisma/client";
import { appointmentIntervalsOverlap } from "@/lib/appointment-availability";
import { DEFAULT_SCHEDULE_TIMEZONE } from "@/lib/schedule-temporal-parse";

export type TreatmentPlanBatchSession = {
  id: string;
  sequence: number;
  allocatedPriceCents: number;
};

export type TreatmentPlanBatchCandidate = {
  purchaseId: string;
  patientId: string;
  patientName: string;
  serviceName: string;
  purchasedAt: Date;
  agreedPriceCents: number;
  sessionCountTotal: number;
  schedulableCount: number;
  schedulableValueCents: number;
  sessions: TreatmentPlanBatchSession[];
};

export type PlannedTreatmentPlanSlot = {
  sessionId: string;
  sequence: number;
  startAt: Date;
  endAt: Date;
  priceCents: number;
  label: string;
};

export function buildTreatmentPlanBatchSlots(params: {
  sessions: TreatmentPlanBatchSession[];
  firstStartAt: Date;
  durationMinutes: number;
  intervalDays: number;
  timezone: string;
}): PlannedTreatmentPlanSlot[] {
  const tz = params.timezone || DEFAULT_SCHEDULE_TIMEZONE;
  const duration = Math.max(15, params.durationMinutes);
  const interval = Math.max(1, params.intervalDays);

  const firstLocal = DateTime.fromJSDate(params.firstStartAt, { zone: "utc" }).setZone(tz);

  return params.sessions.map((session, index) => {
    const startLocal = firstLocal.plus({ days: index * interval });
    const endLocal = startLocal.plus({ minutes: duration });
    return {
      sessionId: session.id,
      sequence: session.sequence,
      startAt: startLocal.toUTC().toJSDate(),
      endAt: endLocal.toUTC().toJSDate(),
      priceCents: session.allocatedPriceCents,
      label: `${startLocal.toFormat("dd/LL/yyyy HH:mm")} (sessão ${session.sequence})`,
    };
  });
}

export function findInternalBatchSlotOverlap(
  slots: Array<{ startAt: Date; endAt: Date; label: string }>,
): string | null {
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i]!;
      const b = slots[j]!;
      if (appointmentIntervalsOverlap(a.startAt, a.endAt, b.startAt, b.endAt)) {
        return `Conflito entre ${a.label} e ${b.label} no mesmo lote.`;
      }
    }
  }
  return null;
}

export type TreatmentPlanPurchaseRow = {
  id: string;
  patientId: string;
  agreedPriceCents: number;
  sessionCountTotal: number;
  purchasedAt: Date;
  patient: { name: string };
  service: { name: string };
  sessions: Array<{
    id: string;
    sequence: number;
    status: PatientServiceSessionStatus;
    allocatedPriceCents: number;
    appointment: { id: string } | null;
  }>;
};

export function mapPurchaseToBatchCandidate(row: TreatmentPlanPurchaseRow): TreatmentPlanBatchCandidate | null {
  const schedulable = row.sessions.filter(
    (s) => s.status === PatientServiceSessionStatus.PENDING && !s.appointment,
  );
  if (schedulable.length === 0) return null;

  return {
    purchaseId: row.id,
    patientId: row.patientId,
    patientName: row.patient.name,
    serviceName: row.service.name,
    purchasedAt: row.purchasedAt,
    agreedPriceCents: row.agreedPriceCents,
    sessionCountTotal: row.sessionCountTotal,
    schedulableCount: schedulable.length,
    schedulableValueCents: schedulable.reduce((sum, s) => sum + s.allocatedPriceCents, 0),
    sessions: schedulable.map((s) => ({
      id: s.id,
      sequence: s.sequence,
      allocatedPriceCents: s.allocatedPriceCents,
    })),
  };
}

export const TREATMENT_PLAN_BATCH_DEFAULTS = {
  durationMinutes: 60,
  intervalDays: 7,
  careSetting: AppointmentCareSetting.IN_PERSON_CLINIC,
  source: AppointmentSource.MANUAL,
  visitKind: AppointmentVisitKind.TREATMENT_PLAN,
  confirmationStatus: AppointmentConfirmationStatus.PENDING_CONFIRMATION,
  status: AppointmentStatus.SCHEDULED,
} as const;
