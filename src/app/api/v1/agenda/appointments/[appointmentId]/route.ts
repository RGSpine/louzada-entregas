import type { NextRequest } from "next/server";
import { apiV1Error, apiV1Ok, requireApiV1Auth } from "@/lib/api-v1/response";
import { serializeSuggestedSlots } from "@/lib/api-v1/serialize-appointment";
import { updateAppointmentForUser } from "@/server/services/appointments";
import { API_V1_WRITE_RATE_LIMIT } from "@/lib/rate-limit";
import { requireApiV1IntraUser } from "@/lib/intra-user/patient-access";

type RouteParams = { params: Promise<{ appointmentId: string }> };

/** Atualiza marcação — body JSON parcial. */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = await requireApiV1Auth(
    request,
    API_V1_WRITE_RATE_LIMIT,
    "api/v1/agenda/appointments:update",
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

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiV1Error("INVALID_JSON", "Corpo JSON inválido.", 400);
  }

  const result = await updateAppointmentForUser(
    auth.ctx.dbUser.id,
    {
      appointmentId,
      ...body,
    },
    { activeIntraUser: intra.activeIntraUser },
  );

  if (!result.success) {
    return apiV1Error(
      result.suggestedSlots ? "SCHEDULE_CONFLICT" : "AGENDA_UPDATE_FAILED",
      result.error,
      result.suggestedSlots ? 409 : 400,
      result.suggestedSlots
        ? { suggestedSlots: serializeSuggestedSlots(result.suggestedSlots) }
        : undefined,
    );
  }

  return apiV1Ok({
    id: result.data?.id,
    becameCompleted: result.data?.becameCompleted ?? false,
  });
}
