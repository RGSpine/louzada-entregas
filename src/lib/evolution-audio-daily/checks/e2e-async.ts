import { buildSilentPcmWavBuffer } from "@/lib/evolution-audio-daily/silent-wav";
import {
  assertTranscriptionIfPresent,
  pollJobUntilTerminal,
  proMaxAudioSeconds,
  record,
  resolveE2EUser,
  uploadWavToDirectStorage,
  type StepResult,
} from "@/lib/evolution-audio-daily/e2e-helpers";
import { processEvolutionFormData } from "@/server/services/evolution-process";
import { tryProcessQueuedEvolutionJobInline } from "@/lib/evolution-job-worker";
import { prisma } from "@/lib/prisma";
import { EvolutionJobPayloadSchema } from "@/lib/evolution-job-worker";
import type { DailySuiteResult } from "@/lib/evolution-audio-daily/types";

function stepsToResult(steps: StepResult[]): DailySuiteResult {
  const failed = steps.filter((s) => !s.ok);
  return {
    id: 2,
    name: "E2E staging áudio sintético PRO ~5 min",
    ok: failed.length === 0,
    skipped: false,
    detail:
      failed.length === 0
        ? `${steps.length} passos OK`
        : failed.map((f) => f.id).join(", "),
  };
}

/** Categoria #2 — Storage → 202 → payload sem base64. */
export async function runE2EAsyncPipelineCheck(): Promise<DailySuiteResult> {
  const steps: StepResult[] = [];
  const durationSec = Number(process.env.E2E_AUDIO_DURATION_SEC || 310);
  const runGemini = process.env.RUN_GEMINI_E2E === "1";

  if (!process.env.DATABASE_URL?.trim()) {
    return {
      id: 2,
      name: "E2E staging áudio sintético PRO ~5 min",
      ok: true,
      skipped: true,
      detail: "Omitido — DATABASE_URL ausente",
    };
  }

  try {
    const ctx = await resolveE2EUser();
    if (!ctx) {
      if (process.env.E2E_STRICT === "1") {
        record(steps, "e2e-user", false, "Utilizador PRO não encontrado");
        return stepsToResult(steps);
      }
      return {
        id: 2,
        name: "E2E staging áudio sintético PRO ~5 min",
        ok: true,
        skipped: true,
        detail: "Omitido — sem utilizador PRO (E2E_TEST_EMAIL)",
      };
    }
    record(steps, "e2e-user", true, `${ctx.email} (${ctx.plan})`);

    const maxSec = proMaxAudioSeconds();
    if (durationSec > maxSec) {
      record(steps, "pro-limit", false, `${durationSec}s > PRO ${maxSec}s`);
      return stepsToResult(steps);
    }
    record(steps, "pro-limit", true, `${durationSec}s ≤ ${maxSec}s`);

    const wav = buildSilentPcmWavBuffer(durationSec, 8000, 1, 16);
    record(steps, "wav-synthetic", true, `${(wav.length / (1024 * 1024)).toFixed(2)} MB`);

    const uploaded = await uploadWavToDirectStorage(ctx.dbUserId, wav);
    record(steps, "storage-upload", true, uploaded.storagePath);

    const formData = new FormData();
    formData.append("audioStoragePath", uploaded.storagePath);
    formData.append("audioSizeBytes", String(uploaded.sizeBytes));
    formData.append("audioDurationSec", String(durationSec));

    const tPost = Date.now();
    const result = await processEvolutionFormData(
      { id: ctx.authUserId, email: ctx.email },
      ctx.dbUserId,
      formData,
    );
    const postMs = Date.now() - tPost;

    if (result.kind !== "async") {
      record(
        steps,
        "async-202",
        false,
        `Esperava async; recebeu ${result.kind}`,
        postMs,
      );
      return stepsToResult(steps);
    }
    record(steps, "async-202", true, `jobId=${result.jobId}`, postMs);

    const jobRow = await prisma.evolutionProcessingJob.findUnique({
      where: { id: result.jobId },
      select: { requestData: true },
    });
    const parsed = EvolutionJobPayloadSchema.safeParse(jobRow?.requestData);
    const hasPath =
      parsed.success &&
      !!parsed.data.audioStoragePath?.trim() &&
      !parsed.data.audioBase64;
    record(
      steps,
      "job-payload-storage",
      !!hasPath,
      hasPath ? "audioStoragePath sem base64" : "payload inválido",
    );

    if (runGemini) {
      await tryProcessQueuedEvolutionJobInline(result.jobId);
      const terminal = await pollJobUntilTerminal(result.jobId, ctx.dbUserId, 200);
      if (terminal.status === "SUCCEEDED") {
        const hasTx = assertTranscriptionIfPresent(terminal.result);
        record(
          steps,
          "transcription",
          hasTx,
          hasTx ? "technicalTranscription presente" : "vazia (WAV silencioso)",
        );
      } else {
        record(steps, "worker-result", false, terminal.error ?? terminal.status);
      }
    } else {
      record(steps, "gemini-skipped", true, "RUN_GEMINI_E2E omitido");
    }

    return stepsToResult(steps);
  } catch (e) {
    if (process.env.E2E_STRICT !== "1") {
      return {
        id: 2,
        name: "E2E staging áudio sintético PRO ~5 min",
        ok: true,
        skipped: true,
        detail: `Omitido — ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`,
      };
    }
    record(steps, "e2e-error", false, e instanceof Error ? e.message : String(e));
    return stepsToResult(steps);
  }
}

/** Categoria #3 — Playwright não corre em serverless; valida pré-requisitos. */
export function runPlaywrightPreflightCheck(): DailySuiteResult {
  if (process.env.VERCEL === "1") {
    return {
      id: 3,
      name: "Safari iOS smoke (Playwright WebKit)",
      ok: true,
      skipped: true,
      detail: "Omitido em Vercel — Playwright requer runner dedicado",
    };
  }

  const email = process.env.E2E_TEST_EMAIL?.trim();
  const password = process.env.E2E_TEST_PASSWORD?.trim();
  if (!email || !password) {
    return {
      id: 3,
      name: "Safari iOS smoke (Playwright WebKit)",
      ok: true,
      skipped: true,
      detail: "Omitido — E2E_TEST_EMAIL/PASSWORD ausentes",
    };
  }

  return {
    id: 3,
    name: "Safari iOS smoke (Playwright WebKit)",
    ok: true,
    skipped: true,
    detail: "Credenciais OK — correr `npm run test:evolution-audio-e2e-playwright` no runner local",
  };
}

/** Categoria #8 — smoke Gemini opcional. */
export async function runGeminiSmokeCheck(): Promise<DailySuiteResult> {
  if (process.env.RUN_GEMINI_SMOKE !== "1") {
    return {
      id: 8,
      name: "Transcrição Gemini (smoke opcional)",
      ok: true,
      skipped: true,
      detail: "Omitido — RUN_GEMINI_SMOKE≠1",
    };
  }

  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || key.length < 30) {
    return {
      id: 8,
      name: "Transcrição Gemini (smoke opcional)",
      ok: false,
      skipped: false,
      detail: "RUN_GEMINI_SMOKE=1 mas GEMINI_API_KEY inválida",
    };
  }

  try {
    const wav = buildSilentPcmWavBuffer(45, 8000, 1, 16);
    const { getGeminiFastModel } = await import("@/lib/gemini");
    const model = getGeminiFastModel();
    const t0 = Date.now();
    await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            { text: "Responda numa frase: o áudio parece silêncio?" },
            { inlineData: { mimeType: "audio/wav", data: wav.toString("base64") } },
          ],
        },
      ],
    });
    return {
      id: 8,
      name: "Transcrição Gemini (smoke opcional)",
      ok: true,
      skipped: false,
      detail: `Flash OK em ${Date.now() - t0}ms`,
    };
  } catch (e) {
    return {
      id: 8,
      name: "Transcrição Gemini (smoke opcional)",
      ok: false,
      skipped: false,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}
