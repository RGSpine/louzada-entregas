import type { NextRequest } from "next/server";
import { apiV1Ok, requireApiV1Auth } from "@/lib/api-v1/response";
import {
  buildDocumentsUserContext,
  getDocumentGenerationQuotaForUser,
} from "@/server/services/clinical-documents";
import { API_V1_READ_RATE_LIMIT } from "@/lib/rate-limit";

/** Quota mensal de documentos gerados por IA. */
export async function GET(request: NextRequest) {
  const auth = await requireApiV1Auth(
    request,
    API_V1_READ_RATE_LIMIT,
    "api/v1/documents/quota",
  );
  if (!auth.ok) return auth.response;

  const quota = await getDocumentGenerationQuotaForUser(buildDocumentsUserContext(auth.ctx));
  return apiV1Ok(quota);
}
