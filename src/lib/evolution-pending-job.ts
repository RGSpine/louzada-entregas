/**
 * Persistência de jobs assíncronos da Nova Evolução no browser (sessionStorage).
 * Permite retomar polling após reload, timeout do cliente ou descarte de aba.
 */

export const EVOLUTION_PENDING_JOB_STORAGE_KEY = "evolution-pending-job-v1";

/** Jobs mais antigos que isto são ignorados na recuperação. */
export const EVOLUTION_PENDING_JOB_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export type EvolutionPendingJobSource = "main" | "additional";

export type StoredEvolutionPendingJob = {
  jobId: string;
  createdAt: string;
  patientId?: string | null;
  source: EvolutionPendingJobSource;
};

function isBrowser(): boolean {
  return typeof globalThis.sessionStorage !== "undefined";
}

export function savePendingEvolutionJob(job: StoredEvolutionPendingJob): void {
  if (!isBrowser()) return;
  try {
    globalThis.sessionStorage.setItem(EVOLUTION_PENDING_JOB_STORAGE_KEY, JSON.stringify(job));
  } catch {
    /* quota / modo privado */
  }
}

export function loadPendingEvolutionJob(): StoredEvolutionPendingJob | null {
  if (!isBrowser()) return null;
  try {
    const raw = globalThis.sessionStorage.getItem(EVOLUTION_PENDING_JOB_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredEvolutionPendingJob>;
    if (typeof parsed.jobId !== "string" || parsed.jobId.length < 4) return null;
    if (typeof parsed.createdAt !== "string") return null;
    const source = parsed.source === "additional" ? "additional" : "main";
    const createdAtMs = Date.parse(parsed.createdAt);
    if (!Number.isFinite(createdAtMs)) return null;
    if (Date.now() - createdAtMs > EVOLUTION_PENDING_JOB_MAX_AGE_MS) {
      clearPendingEvolutionJob();
      return null;
    }
    return {
      jobId: parsed.jobId,
      createdAt: parsed.createdAt,
      patientId: typeof parsed.patientId === "string" ? parsed.patientId : null,
      source,
    };
  } catch {
    return null;
  }
}

export function clearPendingEvolutionJob(): void {
  if (!isBrowser()) return;
  try {
    globalThis.sessionStorage.removeItem(EVOLUTION_PENDING_JOB_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
