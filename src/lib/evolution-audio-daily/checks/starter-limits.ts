import { getPlanLimits } from "@/lib/plan-limits";
import type { DailySuiteResult } from "@/lib/evolution-audio-daily/types";

const MAX_AUDIO_BYTES_ROUTE = 40 * 1024 * 1024;

/** Categoria #6 — limites STARTER sem custo Gemini. */
export function runStarterLimitChecks(): DailySuiteResult {
  try {
    const starter = getPlanLimits("PROFISSIONAL", null, false);
    const maxSec = starter.maxAudioMinutes * 60;
    if (maxSec <= 0) throw new Error("maxAudioMinutes STARTER inválido");

    const approxBytes = maxSec * 8000 * 2;
    if (approxBytes > MAX_AUDIO_BYTES_ROUTE) {
      throw new Error(
        `WAV estimado ${approxBytes} bytes excede teto rota ${MAX_AUDIO_BYTES_ROUTE}`,
      );
    }

    return {
      id: 6,
      name: "Limites plano Profissional (integridade ficheiro)",
      ok: true,
      skipped: false,
      detail: `${starter.maxAudioMinutes} min (${maxSec}s) ≤ 40 MB rota`,
    };
  } catch (e) {
    return {
      id: 6,
      name: "Limites plano Profissional (integridade ficheiro)",
      ok: false,
      skipped: false,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}
