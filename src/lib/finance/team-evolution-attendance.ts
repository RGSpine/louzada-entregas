/**
 * Textos do painel admin (Consultório/Clínica): atendimento por Intra User.
 * Sem Prisma — usado também na UI.
 */

export type TeamEvolutionAttendanceRow = {
  evolutionId: string;
  attendanceDateIso: string;
  patientId: string;
  patientName: string;
  professionalName: string;
  professionalColor: string | null;
  professionalRole: "ADMIN" | "MEMBER" | null;
  sessionConsumed: boolean;
  sessionLabel: string | null;
  saleClosed: boolean;
  saleLabel: string | null;
  salePaid: boolean | null;
};

export function formatTeamAttendanceDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR");
}

export function formatTeamAttendanceOutcome(row: TeamEvolutionAttendanceRow): string {
  const parts: string[] = [];
  if (row.sessionConsumed && row.sessionLabel) {
    parts.push(row.sessionLabel);
  } else if (!row.sessionConsumed) {
    parts.push("Sem baixa de sessão");
  }
  if (row.saleClosed && row.saleLabel) {
    parts.push(
      row.salePaid
        ? `Fechou ${row.saleLabel} (pago no caixa)`
        : `Fechou ${row.saleLabel} (pagamento pendente)`,
    );
  } else {
    parts.push("Não fechou serviço/plano novo");
  }
  return parts.join(" · ");
}
