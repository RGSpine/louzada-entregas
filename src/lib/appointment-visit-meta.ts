import {
  AppointmentCareSetting,
  AppointmentStatus,
  AppointmentVisitKind,
} from "@prisma/client";
import type { calendar_v3 } from "googleapis";
import { sanitizeText } from "@/lib/sanitize";
import { resolveAppointmentServiceDisplayName } from "./appointment-service-meta";

export const AEVOLUI_GOOGLE_MARKER = "Louzada Entregas";

/** Chaves em extendedProperties.private (round-trip OAuth). */
export const GOOGLE_PRIVATE_KEYS = {
  visitKind: "aievolui_visit_kind",
  careSetting: "aievolui_care_setting",
} as const;

export const VISIT_KIND_LABELS: Record<AppointmentVisitKind, string> = {
  UNIQUE_CONSULTATION: "Serviço avulso",
  RETURN: "Retorno",
  TREATMENT_PLAN: "Sessão de pacote",
};

export const CARE_SETTING_LABELS: Record<AppointmentCareSetting, string> = {
  IN_PERSON_CLINIC: "Consultório/clínica",
  ONLINE: "Online",
  HOME_VISIT: "Domiciliar",
};

export const CARE_SETTING_NOTES_PLACEHOLDER: Record<AppointmentCareSetting, string> = {
  IN_PERSON_CLINIC: "Sala, bloco, orientações ao paciente…",
  ONLINE: "Link da videochamada, plataforma, instruções ao paciente…",
  HOME_VISIT: "Endereço, referências, instruções de acesso…",
};

const VISIT_KIND_SUMMARY_PREFIX: Record<AppointmentVisitKind, string> = {
  UNIQUE_CONSULTATION: "Serviço",
  RETURN: "Retorno",
  TREATMENT_PLAN: "Pacote",
};

const AEVOLUI_SUMMARY_PATTERN =
  /^(Consulta|Serviço|Retorno|Tratamento\/plano|Pacote)\s*[—–-]\s*(.+)$/i;

export function formatVisitKindLabel(kind: AppointmentVisitKind): string {
  return VISIT_KIND_LABELS[kind];
}

export function formatCareSettingLabel(setting: AppointmentCareSetting): string {
  return CARE_SETTING_LABELS[setting];
}

export function formatPriceCentsBRL(cents: number | null | undefined): string | null {
  if (cents == null || !Number.isFinite(cents) || cents < 0) return null;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

export function isAievoluiAgendaGoogleSummary(summary?: string | null): boolean {
  if (!summary?.trim()) return false;
  return AEVOLUI_SUMMARY_PATTERN.test(summary.trim());
}

export function parsePatientNameFromAievoluiSummary(summary?: string | null): string | null {
  if (!summary?.trim()) return null;
  const match = AEVOLUI_SUMMARY_PATTERN.exec(summary.trim());
  if (match?.[2]?.trim()) {
    return match[2].trim();
  }
  const trimmed = summary.trim();
  return trimmed.length >= 2 ? trimmed : null;
}

export function buildGoogleEventSummary(input: {
  patientName: string;
  title?: string | null;
  visitKind: AppointmentVisitKind;
}): string {
  const customTitle = input.title?.trim();
  if (customTitle) return customTitle;
  const prefix = VISIT_KIND_SUMMARY_PREFIX[input.visitKind];
  return `${prefix} — ${input.patientName}`;
}

function statusNoteForGoogle(status: AppointmentStatus): string {
  if (status === AppointmentStatus.COMPLETED) return " (concluída no Louzada Entregas)";
  if (status === AppointmentStatus.CANCELLED) return " (cancelada no Louzada Entregas)";
  if (status === AppointmentStatus.NO_SHOW) return " (falta no Louzada Entregas)";
  return "";
}

function parseNotesFromGoogleDescription(description?: string | null): string | null {
  if (!description) return null;
  const match = /Observações:\s*([\s\S]*?)(?:\n\n|$)/i.exec(description);
  if (!match?.[1]) return null;
  const notes = match[1].trim();
  return notes.length > 0 ? notes : null;
}

function parseLabeledField(description: string, label: string): string | null {
  const re = new RegExp(`${label}:\\s*(.+?)(?:\\n|$)`, "i");
  const match = re.exec(description);
  return match?.[1]?.trim() ?? null;
}

function visitKindFromLabel(label: string): AppointmentVisitKind | null {
  const normalized = label.trim().toLowerCase();
  if (normalized === "consulta única" || normalized === "consulta") {
    return AppointmentVisitKind.UNIQUE_CONSULTATION;
  }
  if (normalized === "retorno") return AppointmentVisitKind.RETURN;
  if (normalized === "tratamento/plano" || normalized === "tratamento" || normalized === "plano") {
    return AppointmentVisitKind.TREATMENT_PLAN;
  }
  if (
    normalized === "serviço avulso" ||
    normalized === "servico avulso" ||
    normalized === "serviço" ||
    normalized === "servico"
  ) {
    return AppointmentVisitKind.UNIQUE_CONSULTATION;
  }
  if (normalized === "sessão de pacote" || normalized === "sessao de pacote") {
    return AppointmentVisitKind.TREATMENT_PLAN;
  }
  return null;
}

function careSettingFromLabel(label: string): AppointmentCareSetting | null {
  const normalized = label.trim().toLowerCase();
  if (normalized === "consultório/clínica" || normalized === "consultorio/clinica" || normalized === "presencial") {
    return AppointmentCareSetting.IN_PERSON_CLINIC;
  }
  if (normalized === "online") return AppointmentCareSetting.ONLINE;
  if (normalized === "domiciliar") return AppointmentCareSetting.HOME_VISIT;
  return null;
}

export function parseVisitKindValue(raw: string | null | undefined): AppointmentVisitKind | null {
  if (!raw?.trim()) return null;
  const upper = raw.trim().toUpperCase();
  if (upper in AppointmentVisitKind) {
    return upper as AppointmentVisitKind;
  }
  return visitKindFromLabel(raw);
}

export function parseCareSettingValue(raw: string | null | undefined): AppointmentCareSetting | null {
  if (!raw?.trim()) return null;
  const upper = raw.trim().toUpperCase();
  if (upper in AppointmentCareSetting) {
    return upper as AppointmentCareSetting;
  }
  return careSettingFromLabel(raw);
}

export type GoogleAppointmentMetadata = {
  visitKind: AppointmentVisitKind;
  careSetting: AppointmentCareSetting;
  notes: string | null;
};

export function buildGoogleCalendarDescription(input: {
  visitKind: AppointmentVisitKind;
  careSetting: AppointmentCareSetting;
  notes?: string | null;
  status: AppointmentStatus;
}): string {
  const lines = [
    AEVOLUI_GOOGLE_MARKER + statusNoteForGoogle(input.status),
    `Tipo: ${formatVisitKindLabel(input.visitKind)}`,
    `Local: ${formatCareSettingLabel(input.careSetting)}`,
  ];
  const notes = input.notes?.trim();
  if (notes) {
    lines.push(`Observações: ${sanitizeText(notes)}`);
  }
  return lines.join("\n");
}

export function buildGoogleExtendedProperties(input: {
  visitKind: AppointmentVisitKind;
  careSetting: AppointmentCareSetting;
}): calendar_v3.Schema$Event["extendedProperties"] {
  return {
    private: {
      [GOOGLE_PRIVATE_KEYS.visitKind]: input.visitKind,
      [GOOGLE_PRIVATE_KEYS.careSetting]: input.careSetting,
    },
  };
}

export function parseGoogleCalendarMetadata(
  event: Pick<calendar_v3.Schema$Event, "description" | "extendedProperties">,
): GoogleAppointmentMetadata {
  const priv = event.extendedProperties?.private ?? {};
  const visitKind =
    parseVisitKindValue(priv[GOOGLE_PRIVATE_KEYS.visitKind]) ??
    visitKindFromLabel(parseLabeledField(event.description ?? "", "Tipo") ?? "") ??
    AppointmentVisitKind.UNIQUE_CONSULTATION;

  const careSetting =
    parseCareSettingValue(priv[GOOGLE_PRIVATE_KEYS.careSetting]) ??
    careSettingFromLabel(parseLabeledField(event.description ?? "", "Local") ?? "") ??
    AppointmentCareSetting.IN_PERSON_CLINIC;

  const notes = parseNotesFromGoogleDescription(event.description);

  return { visitKind, careSetting, notes };
}

export function formatAppointmentMetaSubtitle(input: {
  visitKind: AppointmentVisitKind;
  careSetting: AppointmentCareSetting;
  priceCents?: number | null;
  serviceName?: string | null;
}): string {
  const parts = [
    resolveAppointmentServiceDisplayName({
      serviceName: input.serviceName,
      visitKind: input.visitKind,
    }),
    formatCareSettingLabel(input.careSetting),
  ];
  const price = formatPriceCentsBRL(input.priceCents);
  if (price) parts.push(price);
  return parts.join(" · ");
}
