import type { NextRequest } from "next/server";
import { apiV1Error, apiV1Ok, requireApiV1Auth } from "@/lib/api-v1/response";
import { API_V1_READ_RATE_LIMIT } from "@/lib/rate-limit";
import { requireApiV1IntraUser } from "@/lib/intra-user/patient-access";
import { getAppointmentEvolutionBootstrapForUser } from "@/server/services/appointment-evolution-link";

type RouteParams = { params: Promise<{ appointmentId: string }> };

/** Contexto de evolução a partir de um slot da agenda. */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireApiV1Auth(
    request,
    API_V1_READ_RATE_LIMIT,
    "api/v1/agenda:evolution-bootstrap",
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

  const { appointmentId } = await params;
  const result = await getAppointmentEvolutionBootstrapForUser(
    auth.ctx.dbUser.id,
    appointmentId,
    { activeIntraUser: intra.activeIntraUser },
  );

  if (!result.success) {
    return apiV1Error("APPOINTMENT_NOT_FOUND", result.error, 404);
  }

  return apiV1Ok({ bootstrap: result.data });
}
