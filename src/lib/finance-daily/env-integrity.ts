import type { FinanceEnvIntegrityReport } from "@/lib/finance-daily/types";

/**
 * Pré-requisitos da suite diária financeira.
 * DATABASE_URL é obrigatório para QA DB + smoke.
 */
export function checkFinanceDailyEnvIntegrity(): FinanceEnvIntegrityReport {
  const required = ["DATABASE_URL"] as const;
  const optional = [
    "DIRECT_URL",
    "CRON_SECRET",
    "FINANCE_SMOKE_NFSE",
    "NOTAAS_API_KEY",
    "E2E_TEST_EMAIL",
  ] as const;

  const missingRequired = required.filter((k) => !process.env[k]?.trim());
  const missingOptional = optional.filter((k) => !process.env[k]?.trim());

  return {
    ok: missingRequired.length === 0,
    readyForAutoRun: missingRequired.length === 0,
    missingRequired: [...missingRequired],
    missingOptional: [...missingOptional],
  };
}
