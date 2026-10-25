import type { EnvIntegrityReport, EnvVarStatus } from "@/lib/evolution-audio-daily/types";

const ENV_SPECS: Array<Omit<EnvVarStatus, "present">> = [
  { key: "DATABASE_URL", required: true, category: "core", note: "Estado da suite + E2E + métricas" },
  { key: "CRON_SECRET", required: true, category: "core", note: "Auth cron + kick worker" },
  {
    key: "SUPABASE_URL",
    required: true,
    category: "core",
    note: "Upload Storage E2E",
  },
  {
    key: "SUPABASE_ANON_KEY",
    required: true,
    category: "core",
    note: "Login E2E Supabase",
  },
  {
    key: "SUPABASE_SERVICE_ROLE_KEY",
    required: true,
    category: "core",
    note: "Signed URLs Storage",
  },
  { key: "GEMINI_API_KEY", required: false, category: "gemini", note: "Smoke/run Gemini opcional" },
  { key: "E2E_TEST_EMAIL", required: false, category: "e2e", note: "Utilizador PRO para E2E" },
  {
    key: "E2E_EVOLUTION_BASE_URL",
    required: false,
    category: "e2e",
    note: "Kick HTTP staging/prod",
  },
  { key: "E2E_TEST_PASSWORD", required: false, category: "playwright", note: "Login browser" },
  {
    key: "KV_REST_API_URL",
    required: false,
    category: "optional",
    note: "Vercel KV / Upstash — rate limit Edge + servidor",
  },
  {
    key: "UPSTASH_REDIS_REST_URL",
    required: false,
    category: "optional",
    note: "Fallback rate limit se KV_* ausente",
  },
];

function isPresent(key: string): boolean {
  const v = process.env[key]?.trim();
  if (!v) return false;
  if (key === "GEMINI_API_KEY" && (v === "..." || v.length < 30)) return false;
  return true;
}

/** Verifica presença das variáveis (nunca expõe valores). */
export function checkEvolutionAudioEnvIntegrity(): EnvIntegrityReport {
  const vars: EnvVarStatus[] = ENV_SPECS.map((spec) => ({
    ...spec,
    present: isPresent(spec.key),
  }));

  const missingRequired = vars.filter((v) => v.required && !v.present).map((v) => v.key);
  const missingOptional = vars.filter((v) => !v.required && !v.present).map((v) => v.key);

  const readyForAutoRun =
    missingRequired.length === 0 &&
    isPresent("DATABASE_URL") &&
    isPresent("CRON_SECRET");

  return {
    ok: missingRequired.length === 0,
    readyForAutoRun,
    vars,
    missingRequired,
    missingOptional,
  };
}
