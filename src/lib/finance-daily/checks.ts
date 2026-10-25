import { runTsxCheck } from "@/lib/finance-daily/run-tsx-check";
import type { FinanceDailyResult } from "@/lib/finance-daily/types";

/** Unitários offline (RBAC, P2, security, simulação manual). */
export async function runFinanceUnitChecks(): Promise<FinanceDailyResult[]> {
  return [
    await runTsxCheck({
      id: 1,
      name: "Unitários finance (RBAC + P2 + security + sim manual)",
      args: [
        "--test",
        "src/lib/finance/finance-rbac-p2.test.ts",
        "src/lib/finance/finance-security.test.ts",
        "src/lib/finance/finance-manual-sim.test.ts",
      ],
      timeoutMs: 120_000,
    }),
  ];
}

/** QA DB: caixa↔agenda + fluxo paciente↔agenda. */
export async function runFinanceQaDbChecks(): Promise<FinanceDailyResult[]> {
  if (!process.env.DATABASE_URL?.trim()) {
    return [
      {
        id: 2,
        name: "QA caixa↔agenda (qa-finance)",
        ok: false,
        skipped: true,
        detail: "DATABASE_URL ausente",
      },
      {
        id: 3,
        name: "QA paciente↔agenda (test-finance-patient-agenda-flow)",
        ok: false,
        skipped: true,
        detail: "DATABASE_URL ausente",
      },
    ];
  }

  return [
    await runTsxCheck({
      id: 2,
      name: "QA caixa↔agenda (qa-finance-caixa-vinculo)",
      args: ["scripts/qa-finance-caixa-vinculo.ts"],
      timeoutMs: 180_000,
    }),
    await runTsxCheck({
      id: 3,
      name: "QA paciente↔agenda (test-finance-patient-agenda-flow)",
      args: ["scripts/test-finance-patient-agenda-flow.ts"],
      timeoutMs: 180_000,
    }),
  ];
}

/**
 * Smoke staging: venda → agenda → COMPLETED → caixa → (opcional) NFS-e.
 * Desactivar: FINANCE_SMOKE_STAGING=0
 */
export async function runFinanceSmokeStagingCheck(): Promise<FinanceDailyResult> {
  if (process.env.FINANCE_SMOKE_STAGING === "0") {
    return {
      id: 4,
      name: "Smoke staging venda→agenda→COMPLETED→caixa",
      ok: true,
      skipped: true,
      detail: "Desactivado (FINANCE_SMOKE_STAGING=0)",
    };
  }
  if (!process.env.DATABASE_URL?.trim()) {
    return {
      id: 4,
      name: "Smoke staging venda→agenda→COMPLETED→caixa",
      ok: false,
      skipped: true,
      detail: "DATABASE_URL ausente",
    };
  }

  return runTsxCheck({
    id: 4,
    name: "Smoke staging venda→agenda→COMPLETED→caixa (+ NFS-e opcional)",
    args: ["scripts/smoke-finance-staging.ts"],
    timeoutMs: 240_000,
    env: {
      FINANCE_SMOKE_NFSE: process.env.FINANCE_SMOKE_NFSE ?? "0",
    },
  });
}
