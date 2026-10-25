import type { NextRequest } from "next/server";
import { apiV1Error, apiV1Ok, requireApiV1Auth } from "@/lib/api-v1/response";
import { API_V1_WRITE_RATE_LIMIT } from "@/lib/rate-limit";
import {
  SignUploadSchema,
  createDirectUploadSignedUrl,
} from "@/lib/uploads/direct-upload";
import { logger } from "@/lib/logger";

/**
 * Gera signed upload URL do Supabase Storage para upload direto
 * (áudio de evolução / exames) a partir do mobile/PWA.
 * O path é sempre gerado no servidor, isolado por utilizador.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiV1Auth(
      request,
      API_V1_WRITE_RATE_LIMIT,
      "api/v1/uploads/sign",
    );
    if (!auth.ok) {
      return auth.response;
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return apiV1Error("INVALID_BODY", "Body JSON inválido.", 400);
    }

    const parsed = SignUploadSchema.safeParse(rawBody);
    if (!parsed.success) {
      return apiV1Error(
        "VALIDATION_ERROR",
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        400,
      );
    }

    const result = await createDirectUploadSignedUrl(auth.ctx.dbUser.id, parsed.data);
    if (!result.ok) {
      return apiV1Error("SIGN_UPLOAD_FAILED", result.error, result.httpStatus);
    }

    return apiV1Ok(result.data);
  } catch (error) {
    logger.error("API v1 uploads/sign: erro inesperado", {
      feature: "api/v1/uploads/sign",
      error: error instanceof Error ? error.message : String(error),
    });
    return apiV1Error("INTERNAL_ERROR", "Erro ao gerar URL de upload.", 500);
  }
}
