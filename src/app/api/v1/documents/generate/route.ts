import type { NextRequest } from "next/server";
import { apiV1Error, apiV1Ok, requireApiV1AiAuth } from "@/lib/api-v1/response";
import {
  buildDocumentsUserContext,
  generateClinicalDocumentForUser,
} from "@/server/services/clinical-documents";
import { requireApiV1IntraUser } from "@/lib/intra-user/patient-access";

export const maxDuration = 120;

/** Gera documento clínico (PDF) a partir de rascunho + IA. */
export async function POST(request: NextRequest) {
  const auth = await requireApiV1AiAuth(request, "api/v1/documents/generate");
  if (!auth.ok) return auth.response;

  const intra = await requireApiV1IntraUser(
    request,
    auth.ctx.dbUser.id,
    auth.ctx.dbUser.plan,
  );
  if (!intra.ok) {
    return apiV1Error("PROFILE_REQUIRED", intra.error, 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiV1Error("INVALID_JSON", "Corpo JSON inválido.", 400);
  }

  const result = await generateClinicalDocumentForUser(
    buildDocumentsUserContext(auth.ctx),
    body,
    { activeIntraUser: intra.activeIntraUser },
  );

  if (!result.success) {
    return apiV1Error(
      "quotaExceeded" in result && result.quotaExceeded
        ? "QUOTA_EXCEEDED"
        : "DOCUMENT_GENERATION_FAILED",
      result.error,
      "quotaExceeded" in result && result.quotaExceeded ? 403 : 400,
    );
  }

  return apiV1Ok({
    fileName: result.fileName,
    publicUrl: result.publicUrl,
    shareUrl: result.shareUrl,
    examId: result.examId,
    emailSent: result.emailSent,
    /** Base64 do PDF — omitir em clientes que só precisam da URL pública. */
    pdfBase64: result.pdfBase64,
  });
}
