import { AppointmentSource } from "@prisma/client";
import { appointmentPatientDisplayName } from "@/lib/patient-clinical-scope";

export type AppointmentPushKind = "consulta" | "compromisso" | "sessao";

export type AppointmentLabelInput = {
  source: AppointmentSource;
  title: string | null;
  patientName: string;
  /** Placeholder Google / só agenda — reforça “compromisso”. */
  agendaOnly?: boolean;
  visitKind?: "UNIQUE_CONSULTATION" | "RETURN" | "TREATMENT_PLAN" | null;
};

/** Nome exibido na push/sino — mesmo critério da grade (GOOGLE_SYNC prioriza title). */
export function appointmentPushDisplayName(input: AppointmentLabelInput): string {
  return appointmentPatientDisplayName({
    source: input.source,
    title: input.title,
    patientName: input.patientName,
  });
}

/**
 * Classifica o evento para o título da notificação.
 * Google Sync / placeholder agenda → compromisso; plano de tratamento → sessão; resto → consulta.
 */
export function appointmentPushKind(input: AppointmentLabelInput): AppointmentPushKind {
  if (input.source === AppointmentSource.GOOGLE_SYNC || input.agendaOnly === true) {
    return "compromisso";
  }
  if (input.visitKind === "TREATMENT_PLAN") return "sessao";
  return "consulta";
}

function kindLabel(kind: AppointmentPushKind): string {
  switch (kind) {
    case "compromisso":
      return "Compromisso";
    case "sessao":
      return "Sessão";
    default:
      return "Consulta";
  }
}

/** Títulos dos lembretes temporais (24h / em breve / ~1h). */
export function appointmentReminderTitles(kind: AppointmentPushKind): {
  dayBefore: string;
  soon: string;
  oneHour: string;
} {
  const noun = kindLabel(kind);
  return {
    dayBefore: `${noun} amanhã`,
    soon: `${noun} em breve`,
    oneHour: `${noun} em cerca de 1 hora`,
  };
}

/** Corpo do lembrete: só o nome correto + horário (sem fantasma entre parênteses). */
export function formatAppointmentReminderBody(input: {
  displayName: string;
  timeLabel: string;
  /** Se true, timeLabel já é só HH:mm (janela 1h). */
  timeOnly?: boolean;
}): string {
  const name = input.displayName.trim();
  if (!name) return input.timeLabel;
  if (input.timeOnly) return `${name} às ${input.timeLabel}`;
  return `${name} — ${input.timeLabel}`;
}

export function formatAgendaDayDigestTitle(count: number): string {
  if (count <= 0) return "Agenda de hoje";
  if (count === 1) return "Agenda de hoje — 1 compromisso";
  return `Agenda de hoje — ${count} compromissos`;
}

/** Até `maxLines` linhas `HH:mm Nome`; resto como “e mais N”. */
export function formatAgendaDayDigestBody(
  rows: Array<{ time: string; name: string }>,
  maxLines = 5,
): string {
  if (rows.length === 0) return "Nenhum compromisso restante hoje.";
  const head = rows.slice(0, maxLines);
  const lines = head.map((r) => `${r.time} ${r.name}`);
  const rest = rows.length - head.length;
  if (rest > 0) lines.push(`e mais ${rest}`);
  return lines.join("\n");
}

export type ActionDigestLine = {
  patientName: string;
  sampleLabel: string;
  patientId: string;
  count: number;
};

export function formatActionItemDigestTitle(lines: ActionDigestLine[]): string {
  if (lines.length === 1) {
    const only = lines[0]!;
    return only.count === 1
      ? `Ponto de ação — ${only.patientName}`
      : `${only.count} pontos de ação — ${only.patientName}`;
  }
  return "Pontos de ação pendentes";
}

/** Até `maxLines` entradas `Paciente: ação`. */
export function formatActionItemDigestBody(
  lines: ActionDigestLine[],
  maxLines = 4,
): string {
  const head = lines.slice(0, maxLines);
  const parts = head.map((l) => `${l.patientName}: ${l.sampleLabel}`);
  const restPatients = lines.length - head.length;
  if (restPatients > 0) {
    parts.push(`e mais ${restPatients} paciente(s)`);
  }
  return parts.join("\n");
}

export function actionItemDigestUrl(lines: ActionDigestLine[]): string {
  if (lines.length === 1) {
    return `/dashboard/patients/${lines[0]!.patientId}#evolucao-artifacts`;
  }
  return "/dashboard/patients";
}
