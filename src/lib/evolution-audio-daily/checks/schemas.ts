import { EvolutionFormSchema } from "@/server/services/evolution-process";
import { EvolutionJobPayloadSchema } from "@/lib/evolution-job-worker";
import type { DailySuiteResult } from "@/lib/evolution-audio-daily/types";

/** Categorias #7 e #9 — schemas FormData e payload job. */
export function runSchemaChecks(): DailySuiteResult[] {
  const results: DailySuiteResult[] = [];

  try {
    const form = EvolutionFormSchema.safeParse({
      audioStoragePath: "uid/550e8400-e29b-41d4-a716-446655440000.webm",
      audioSizeBytes: 5_000_000,
      audioDurationSec: 310,
    });
    if (!form.success) throw new Error(form.error.message);

    const job = EvolutionJobPayloadSchema.safeParse({
      mergeMode: false,
      audioBase64: null,
      audioStoragePath: "user-uuid/550e8400-e29b-41d4-a716-446655440000.webm",
      audioMimeForModel: "audio/webm",
      audioDurationSec: 310,
      examFiles: [],
    });
    if (!job.success) throw new Error(job.error.message);
    if (job.data.audioBase64) throw new Error("base64 inesperado");

    results.push({
      id: 7,
      name: "Schemas API evolution FormData",
      ok: true,
      skipped: false,
      detail: "EvolutionFormSchema + EvolutionJobPayloadSchema OK",
    });

    const mobileForm = EvolutionFormSchema.safeParse({
      audioStoragePath: "uid/550e8400-e29b-41d4-a716-446655440000.webm",
      audioSizeBytes: 5_000_000,
      audioDurationSec: 310,
    });
    if (!mobileForm.success) throw new Error(mobileForm.error.message);

    results.push({
      id: 9,
      name: "Mobile payload audioSizeBytes (schema)",
      ok: true,
      skipped: false,
      detail: "EvolutionFormSchema path + audioSizeBytes OK",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!results.some((r) => r.id === 7)) {
      results.push({
        id: 7,
        name: "Schemas API evolution FormData",
        ok: false,
        skipped: false,
        detail: msg,
      });
    }
    if (!results.some((r) => r.id === 9)) {
      results.push({
        id: 9,
        name: "Mobile payload audioSizeBytes (schema)",
        ok: false,
        skipped: false,
        detail: msg,
      });
    }
  }

  return results;
}
