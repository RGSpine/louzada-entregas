import type { NextRequest } from "next/server";
import { apiV1Error, apiV1Ok, requireApiV1Auth } from "@/lib/api-v1/response";
import { API_V1_READ_RATE_LIMIT } from "@/lib/rate-limit";
import { requireApiV1IntraUser } from "@/lib/intra-user/patient-access";
import { getLastEvolutionCopyDraftForUser } from "@/server/services/evolution-copy";

type RouteParams = { params: Promise<{ patientId: string }> };

/** Rascunho da última evolução do paciente (base para copiar/continuar). */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireApiV1Auth(
    request,
    API_V1_READ_RATE_LIMIT,
    "api/v1/patients:last-evolution-copy",
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

  const { patientId } = await params;
  const result = await getLastEvolutionCopyDraftForUser(
    auth.ctx.dbUser.id,
    patientId,
    intra.activeIntraUser,
  );
  if (!result.ok) {
    return apiV1Error("PATIENT_NOT_FOUND", result.error, 404);
  }

  return apiV1Ok({ draft: result.data });
}
