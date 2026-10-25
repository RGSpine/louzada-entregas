import type { NextRequest } from "next/server";
import { apiV1Error, apiV1Ok, requireApiV1Auth } from "@/lib/api-v1/response";
import { API_V1_WRITE_RATE_LIMIT } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import {
  SaveEvolutionApiSchema,
  saveEvolutionForUser,
} from "@/server/services/evolution-save";
import { requireApiV1IntraUser } from "@/lib/intra-user/patient-access";

/** Persiste evolução revisada (cria paciente se necessário) — auth cookie ou Bearer. */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiV1Auth(
      request,
      API_V1_WRITE_RATE_LIMIT,
      "api/v1/evolution/save",
    );
    if (!auth.ok) return auth.response;

    const intra = await requireApiV1IntraUser(
      request,
      auth.ctx.dbUser.id,
      auth.ctx.dbUser.plan,
    );
    if (!intra.ok) {
      return apiV1Error("PROFILE_REQUIRED", intra.error, 403);
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return apiV1Error("INVALID_BODY", "Body JSON inválido.", 400);
    }

    const parsed = SaveEvolutionApiSchema.safeParse(rawBody);
    if (!parsed.success) {
      return apiV1Error(
        "VALIDATION_ERROR",
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        400,
      );
    }

    const result = await saveEvolutionForUser(
      auth.ctx.dbUser.id,
      parsed.data,
      intra.activeIntraUser,
    );
    if (!result.success) {
      return apiV1Error(
        result.planLimit ? "PLAN_LIMIT" : "SAVE_EVOLUTION_FAILED",
        result.error,
        result.planLimit ? 403 : 400,
      );
    }

    return apiV1Ok({
      evolutionId: result.evolutionId,
      patientId: result.patientId,
      isNewPatient: result.isNewPatient,
      sessionConsumption: result.sessionConsumption ?? null,
    });
  } catch (error) {
    logger.error("API v1 evolution/save: erro inesperado", {
      feature: "api/v1/evolution/save",
      error: error instanceof Error ? error.message : String(error),
    });
    return apiV1Error("INTERNAL_ERROR", "Erro ao salvar evolução.", 500);
  }
}
