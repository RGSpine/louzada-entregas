import { z } from "zod";
import {
  ALLOWED_AUDIO_MIME,
  MAX_AUDIO_BYTES,
  resolveAudioMime,
} from "@/lib/evolution-hybrid";
import { canUseYieldManagement, YIELD_MANAGEMENT_PLAN_ERROR } from "@/lib/plan-limits";
import { getYieldDashboard } from "@/app/actions/yield-config";
import { extractYieldVoiceIntent } from "@/lib/marketplace/yield-voice-extract";
import { applyYieldVoiceIntent } from "@/lib/marketplace/yield-voice-apply";
import {
  DEFAULT_YIELD_CONFIG,
  type YieldDashboardData,
} from "@/lib/marketplace/yield-schema";
import type { DocumentsUserContext } from "@/server/services/clinical-documents";

const IntakeFormSchema = z.object({
  mode: z.literal("audio"),
});

export type YieldIntakeUser = Pick<
  DocumentsUserContext,
  "id" | "plan" | "email" | "isInfluencer"
>;

export type YieldIntakeResult =
  | {
      ok: true;
      action: string | null;
      enabled?: boolean;
      offered: Array<{ startAt: string }>;
      withdrawn: Array<{ startAt: string }>;
      windowsSaved: number;
      windowsDeleted: number;
      errors: string[];
      summary: string | null;
      confidenceOverall: number | null;
      dashboard: YieldDashboardData | null;
    }
  | {
      ok: false;
      error: string;
      status: number;
      summary?: string | null;
      confidenceOverall?: number | null;
    };

export async function processYieldIntakeForUser(
  user: YieldIntakeUser,
  formData: FormData,
): Promise<YieldIntakeResult> {
  if (!canUseYieldManagement(user.plan, user.email, user.isInfluencer)) {
    return {
      ok: false,
      status: 403,
      error: YIELD_MANAGEMENT_PLAN_ERROR,
    };
  }

  const parsedForm = IntakeFormSchema.safeParse({
    mode: formData.get("mode"),
  });
  if (!parsedForm.success) {
    return {
      ok: false,
      status: 400,
      error: "Envie um áudio de comando (mode=audio).",
    };
  }

  const audioFile = formData.get("audio");
  if (!(audioFile instanceof File) || audioFile.size === 0) {
    return { ok: false, status: 400, error: "Áudio não enviado." };
  }
  if (audioFile.size > MAX_AUDIO_BYTES) {
    return { ok: false, status: 400, error: "Áudio excede 40 MB." };
  }
  const mime = resolveAudioMime(audioFile);
  if (!ALLOWED_AUDIO_MIME.has(mime)) {
    return { ok: false, status: 400, error: `Tipo de áudio não permitido: ${mime}` };
  }

  const buf = Buffer.from(await audioFile.arrayBuffer());
  const audio = { base64: buf.toString("base64"), mimeType: mime };

  const dash = await getYieldDashboard();
  if (!dash.success) {
    return {
      ok: false,
      status: dash.code === "PLAN_REQUIRED" ? 403 : 502,
      error: dash.error,
    };
  }

  const extracted = await extractYieldVoiceIntent({
    config: dash.data.config,
    windows: dash.data.windows,
    audio,
  });
  if (!extracted.ok) {
    return { ok: false, status: 502, error: extracted.error };
  }

  const model = extracted.data;
  if (model.action === "none") {
    return {
      ok: true,
      action: null,
      offered: [],
      withdrawn: [],
      windowsSaved: 0,
      windowsDeleted: 0,
      errors: [],
      summary: model.transcriptOrSummary ?? "Nenhum comando de yield identificado.",
      confidenceOverall: model.confidenceOverall,
      dashboard: dash.data,
    };
  }

  if (model.action === "ambiguous" && model.commands.length === 0) {
    return {
      ok: false,
      status: 422,
      error:
        "Não entendi o comando. Ex.: «oferece amanhã às 15h com 30%» ou «ativa a gestão com 30% faltando 24 horas».",
      summary: model.transcriptOrSummary,
      confidenceOverall: model.confidenceOverall,
    };
  }

  const outcome = await applyYieldVoiceIntent({
    model,
    currentConfig: dash.data.config ?? DEFAULT_YIELD_CONFIG,
  });

  const touched =
    outcome.offered.length +
    outcome.withdrawn.length +
    outcome.windowsSaved +
    outcome.windowsDeleted +
    (outcome.enabled !== undefined ? 1 : 0);

  if (touched === 0 && outcome.errors.length > 0) {
    return {
      ok: false,
      status: 422,
      error: outcome.errors[0] ?? "Não foi possível aplicar o comando.",
      summary: outcome.summary,
      confidenceOverall: model.confidenceOverall,
    };
  }

  return {
    ok: true,
    action: outcome.action,
    enabled: outcome.enabled,
    offered: outcome.offered,
    withdrawn: outcome.withdrawn,
    windowsSaved: outcome.windowsSaved,
    windowsDeleted: outcome.windowsDeleted,
    errors: outcome.errors,
    summary: outcome.summary,
    confidenceOverall: model.confidenceOverall,
    dashboard: outcome.dashboard,
  };
}
