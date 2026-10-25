export type FinanceDailyResult = {
  id: number;
  name: string;
  ok: boolean;
  skipped: boolean;
  detail: string;
};

export type FinanceEnvIntegrityReport = {
  ok: boolean;
  readyForAutoRun: boolean;
  missingRequired: string[];
  missingOptional: string[];
};

export type FinanceDailyReport = {
  startedAt: string;
  finishedAt: string;
  passed: boolean;
  skipped: boolean;
  skipReason?: string;
  source: "cron" | "scheduler" | "manual";
  envReport: FinanceEnvIntegrityReport;
  results: FinanceDailyResult[];
};

export type RunFinanceDailyOptions = {
  source?: FinanceDailyReport["source"];
  force?: boolean;
};
