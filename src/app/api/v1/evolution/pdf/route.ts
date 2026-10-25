import type { NextRequest } from "next/server";
import { apiV1Error, apiV1Ok, requireApiV1Auth } from "@/lib/api-v1/response";
import { API_V1_WRITE_RATE_LIMIT } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import {
  GenerateEvolutionPdfSchema,
  generateEvolutionPdfForUser,
} from "@/server/services/evolution-pdf";

/** Gera PDF da evolução revisada (sem salvar novamente) — auth cookie ou Bearer. */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiV1Auth(
      request,
      API_V1_WRITE_RATE_LIMIT,
      "api/v1/evolution/pdf",
    );
    if (!auth.ok) return auth.response;

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return apiV1Error("INVALID_BODY", "Body JSON inválido.", 400);
    }

    const parsed = GenerateEvolutionPdfSchema.safeParse(rawBody);
    if (!parsed.success) {
      return apiV1Error(
        "VALIDATION_ERROR",
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        400,
      );
    }

    const result = await generateEvolutionPdfForUser(auth.ctx.dbUser.id, parsed.data);
    if (!result.success) {
      return apiV1Error("PDF_GENERATION_FAILED", result.error, 500);
    }

    return apiV1Ok({
      pdfBase64: result.pdfBase64,
      fileName: result.fileName,
    });
  } catch (error) {
    logger.error("API v1 evolution/pdf: erro inesperado", {
      feature: "api/v1/evolution/pdf",
      error: error instanceof Error ? error.message : String(error),
    });
    return apiV1Error("INTERNAL_ERROR", "Erro ao gerar PDF.", 500);
  }
}
