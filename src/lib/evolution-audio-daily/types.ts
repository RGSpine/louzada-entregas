export type DailySuiteResult = {
  id: number;
  name: string;
  ok: boolean;
  skipped: boolean;
  detail: string;
};

export type DailySuiteReport = {
  startedAt: string;
  finishedAt: string;
  passed: boolean;
  skipped: boolean;
  skipReason?: string;
  source: "cron" | "scheduler" | "manual";
  envReport: EnvIntegrityReport;
  results: DailySuiteResult[];
};

export type EnvVarStatus = {
  key: string;
  present: boolean;
  required: boolean;
  category: "core" | "e2e" | "playwright" | "gemini" | "optional";
  note?: string;
};

export type EnvIntegrityReport = {
  ok: boolean;
  readyForAutoRun: boolean;
  vars: EnvVarStatus[];
  missingRequired: string[];
  missingOptional: string[];
};

export type RunDailySuiteOptions = {
  source?: DailySuiteReport["source"];
  force?: boolean;
};
