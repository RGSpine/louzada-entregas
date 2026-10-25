/**
 * Limites de tempo para evolução assíncrona / IA longa (cron + `POST /api/evolution` reutilizam o mesmo teto).
 *
 * - `EVOLUTION_CRON_MAX_DURATION_SECONDS` (opcional): 60–900. Em Vercel Pro costuma ir até 800s;
 *   Hobby/Free tem tetos menores — ajuste se o deploy falhar ou for cortado.
 * - Valor por omissão 800s (~13 min) para áudio longo + Gemini.
 */

const ABSOLUTE_MIN_SECONDS = 60;
const ABSOLUTE_MAX_SECONDS = 900;
const DEFAULT_MAX_DURATION_SECONDS = 800;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

/** Segundos permitidos para a rota `GET /api/cron/evolution-jobs` (export const maxDuration). */
export function getEvolutionCronMaxDurationSeconds(): number {
  const n = parsePositiveInt(
    process.env.EVOLUTION_CRON_MAX_DURATION_SECONDS,
    DEFAULT_MAX_DURATION_SECONDS,
  );
  return Math.min(
    ABSOLUTE_MAX_SECONDS,
    Math.max(ABSOLUTE_MIN_SECONDS, n),
  );
}

/**
 * Avaliado ao carregar o módulo (build/runtime), para `export const maxDuration` na rota.
 */
export const EVOLUTION_CRON_MAX_DURATION = getEvolutionCronMaxDurationSeconds();

/**
 * Minutos sem conclusão após `started_at` antes de marcar PROCESSING como FAILED.
 * Opcional: `EVOLUTION_JOB_STALE_AFTER_MINUTES` (5–240). Se omitido: ceil(maxDuration/60) + 15.
 */
export function getEvolutionJobStaleAfterMinutes(): number {
  const envRaw = process.env.EVOLUTION_JOB_STALE_AFTER_MINUTES?.trim();
  if (envRaw) {
    const n = Number.parseInt(envRaw, 10);
    if (Number.isFinite(n) && n >= 5 && n <= 240) return n;
  }
  const maxDurMin = Math.ceil(getEvolutionCronMaxDurationSeconds() / 60);
  return Math.min(120, Math.max(20, maxDurMin + 15));
}
