export const FINANCE_TABS = [
  { id: "configurar", label: "Gastos Fixos" },
  { id: "catalogo", label: "Catálogo" },
  { id: "registrar", label: "Registrar entradas" },
  { id: "analisar", label: "Analisar" },
  { id: "fiscal", label: "Fiscal" },
] as const;

export type FinanceTabId = (typeof FINANCE_TABS)[number]["id"];
