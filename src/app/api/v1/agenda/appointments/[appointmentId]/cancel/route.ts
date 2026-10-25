import type { NextRequest } from "next/server";
import { apiV1Error, apiV1Ok, requireApiV1Auth } from "@/lib/api-v1/response";
import { cancelAppointmentForUser } from "@/server/services/appointments";
import { API_V1_WRITE_RATE_LIMIT } from "@/lib/rate-limit";
import { requireApiV1IntraUser } from "@/lib/intra-user/patient-access";

type RouteParams = { params: Promise<{ appointmentId: string }> };

/**
 * Remove marcação da agenda.
 * Realizada → só some da grade (sessão/financeiro ficam).
 * Não realizada → apaga o registro no sistema.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireApiV1Auth(
    _request,
    API_V1_WRITE_RATE_LIMIT,
    "api/v1/agenda/appointments:cancel",
  );
  if (!auth.ok) return auth.response;

  const intra = await requireApiV1IntraUser(
    _request,
    auth.ctx.dbUser.id,
    auth.ctx.dbUser.plan,
  );
  if (!intra.ok) {
    return apiV1Error("PROFILE_REQUIRED", intra.error, 403);
  }

  const { appointmentId } = await params;
  const result = await cancelAppointmentForUser(
    auth.ctx.dbUser.id,
    { appointmentId },
    intra.activeIntraUser,
  );

  if (!result.success) {
    return apiV1Error("AGENDA_CANCEL_FAILED", result.error, 400);
  }

  return apiV1Ok({ id: result.data?.id, removal: result.data?.removal });
}
