import type { NextRequest } from "next/server";
import { apiV1Ok, requireApiV1Auth } from "@/lib/api-v1/response";
import { buildApiUserProfile } from "@/server/services/user-profile";
import { API_V1_READ_RATE_LIMIT } from "@/lib/rate-limit";

/** Perfil + plano do usuário autenticado (web cookie ou Bearer mobile/desktop). */
export async function GET(request: NextRequest) {
  const auth = await requireApiV1Auth(request, API_V1_READ_RATE_LIMIT, "api/v1/me");
  if (!auth.ok) {
    return auth.response;
  }

  return apiV1Ok(await buildApiUserProfile(auth.ctx));
}
