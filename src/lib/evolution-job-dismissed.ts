/**
 * Jobs de evolução já recuperados/dispensados pelo utilizador (browser).
 */
export const EVOLUTION_DISMISSED_JOBS_KEY = "evolution-job-dismissed-v1";

export function getDismissedEvolutionJobIds(): Set<string> {
  if (typeof globalThis.localStorage === "undefined") return new Set();
  try {
    const raw = globalThis.localStorage.getItem(EVOLUTION_DISMISSED_JOBS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string" && id.length > 3));
  } catch {
    return new Set();
  }
}

export function dismissEvolutionJobId(jobId: string): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    const set = getDismissedEvolutionJobIds();
    set.add(jobId);
    globalThis.localStorage.setItem(
      EVOLUTION_DISMISSED_JOBS_KEY,
      JSON.stringify([...set].slice(-50)),
    );
  } catch {
    /* quota */
  }
}

export function undismissEvolutionJobId(jobId: string): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    const set = getDismissedEvolutionJobIds();
    set.delete(jobId);
    globalThis.localStorage.setItem(EVOLUTION_DISMISSED_JOBS_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}
