import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  apiV1Error,
  apiV1Ok,
  requireApiV1AiAuth,
} from "@/lib/api-v1/response";
import {
  processEvolutionFormData,
  type EvolutionProcessResult,
} from "@/server/services/evolution-process";
import { logger } from "@/lib/logger";

export const maxDuration = 300;

function mapProcessResultToV1Response(result: EvolutionProcessResult) {
  switch (result.kind) {
    case "error":
      return apiV1Error(
        result.httpStatus === 403 ? "PLAN_LIMIT" : "EVOLUTION_FAILED",
        result.message,
        result.httpStatus,
      );
    case "async":
      return apiV1Ok(
        {
          async: true as const,
          jobId: result.jobId,
          status: result.status,
          createdAt: result.createdAt.toISOString(),
        },
        { status: 202 },
      );
    case "revision":
    case "sync":
      return apiV1Ok(result.body);
  }
}

/** Gera evolução clínica (áudio/exames) — auth cookie ou Bearer. */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiV1AiAuth(request, "api/v1/evolution");
    if (!auth.ok) {
      return auth.response;
    }

    const email = auth.ctx.email;
    if (!email) {
      return apiV1Error("UNAUTHORIZED", "E-mail da sessão ausente.", 401);
    }

    const formData = await request.formData();
    const result = await processEvolutionFormData(
      { id: auth.ctx.authUserId, email },
      auth.ctx.dbUser.id,
      formData,
    );

    return mapProcessResultToV1Response(result);
  } catch (error) {
    logger.error("API v1 evolution: erro inesperado", {
      feature: "api/v1/evolution",
      error: error instanceof Error ? error.message : String(error),
    });
    return apiV1Error(
      "INTERNAL_ERROR",
      error instanceof Error ? error.message : "Erro desconhecido ao processar evolução.",
      500,
    );
  }
}
