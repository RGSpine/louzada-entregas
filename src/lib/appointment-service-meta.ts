import type { AppointmentVisitKind } from "@prisma/client";

/** Rótulos de cobrança na UI da agenda (visitKind = forma de faturar o serviço). */
export const SERVICE_BILLING_LABELS: Record<AppointmentVisitKind, string> = {
  UNIQUE_CONSULTATION: "Avulso (1 sessão)",
  RETURN: "Retorno",
  TREATMENT_PLAN: "Sessão de pacote vendido",
};

export function formatServiceBillingLabel(visitKind: AppointmentVisitKind): string {
  return SERVICE_BILLING_LABELS[visitKind];
}

export function resolveAppointmentServiceDisplayName(input: {
  serviceName?: string | null;
  visitKind: AppointmentVisitKind;
}): string {
  const fromCatalog = input.serviceName?.trim();
  if (fromCatalog) return fromCatalog;
  return formatServiceBillingLabel(input.visitKind);
}
