import type { NextRequest } from "next/server";
import { apiV1Ok, requireApiV1Auth } from "@/lib/api-v1/response";
import { listUserDocumentTemplatesForUser } from "@/server/services/clinical-documents";
import { API_V1_READ_RATE_LIMIT } from "@/lib/rate-limit";

/** Modelos de documento do profissional. */
export async function GET(request: NextRequest) {
  const auth = await requireApiV1Auth(
    request,
    API_V1_READ_RATE_LIMIT,
    "api/v1/documents/templates",
  );
  if (!auth.ok) return auth.response;

  const templates = await listUserDocumentTemplatesForUser(auth.ctx.dbUser.id);
  return apiV1Ok({ templates });
}
