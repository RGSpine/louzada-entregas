import { AppointmentSource, Prisma } from "@prisma/client";

/** Nome do paciente placeholder usado só para marcações GOOGLE_SYNC sem vínculo clínico. */
export const GOOGLE_AGENDA_PLACEHOLDER_PATIENT_NAME = "Compromisso (Google Agenda)";

/** Filtro Prisma: pacientes clínicos (exclui placeholders da agenda / compromissos). */
export const clinicalPatientWhere: Prisma.PatientWhereInput = {
  agendaOnly: false,
};

export function isAgendaPlaceholderPatient(patient: { agendaOnly?: boolean }): boolean {
  return patient.agendaOnly === true;
}

export function isConsultaGoogleSummary(summary?: string | null): boolean {
  return Boolean(summary?.trim() && /^Consulta\s*[—–-]\s*.+$/i.test(summary.trim()));
}

/** Rótulo exibido na agenda — prioriza título do evento Google. */
export function appointmentPatientDisplayName(input: {
  source: AppointmentSource;
  title: string | null;
  patientName: string;
}): string {
  const title = input.title?.trim();
  const patientName = input.patientName.trim();
  if (input.source === AppointmentSource.GOOGLE_SYNC) {
    return title || patientName;
  }
  if (!title) return patientName;
  // Evita "Eric — Eric" após "Corrigir nome" sincronizar título e paciente.
  if (normalizePatientNameForCompare(title) === normalizePatientNameForCompare(patientName)) {
    return patientName;
  }
  return `${patientName} — ${title}`;
}

function normalizePatientNameForCompare(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

/** Nome do card equivale ao paciente cadastrado na marcação (ignora sufixo " — título"). */
export function appointmentDisplayNameMatchesPatient(
  displayName: string,
  registeredName: string,
): boolean {
  const display = displayName.trim();
  const registered = registeredName.trim();
  if (!display || !registered) return display === registered;

  const normDisplay = normalizePatientNameForCompare(display);
  const normRegistered = normalizePatientNameForCompare(registered);
  if (normDisplay === normRegistered) return true;

  const titleSeparator = " — ";
  if (display.includes(titleSeparator)) {
    const head = display.split(titleSeparator)[0]?.trim() ?? display;
    if (normalizePatientNameForCompare(head) === normRegistered) return true;
  }

  return false;
}

/** Nome usado na busca de homônimos quando o card diverge do cadastro. */
export function cardNameForSimilarPatientSearch(
  displayName: string,
  registeredName: string,
): string {
  const display = displayName.trim();
  if (!display) return registeredName.trim();

  if (appointmentDisplayNameMatchesPatient(display, registeredName)) {
    return registeredName.trim() || display;
  }

  const titleSeparator = " — ";
  if (display.includes(titleSeparator)) {
    return (display.split(titleSeparator)[0]?.trim() || display);
  }

  return display;
}

export function appointmentRequiresPatientLinkChoice(input: {
  isAgendaPlaceholderPatient: boolean;
  displayPatientName: string;
  registeredPatientName: string;
}): boolean {
  if (input.isAgendaPlaceholderPatient) return true;
  return !appointmentDisplayNameMatchesPatient(
    input.displayPatientName,
    input.registeredPatientName,
  );
}
