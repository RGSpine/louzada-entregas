import type { NextRequest } from "next/server";
import { apiV1Error, apiV1Ok, requireApiV1Auth } from "@/lib/api-v1/response";
import {
  serializeAppointmentRow,
  serializeSuggestedSlots,
} from "@/lib/api-v1/serialize-appointment";
import {
  createAppointmentForUser,
  listAppointmentsInRangeForUser,
} from "@/server/services/appointments";
import { API_V1_READ_RATE_LIMIT, API_V1_WRITE_RATE_LIMIT } from "@/lib/rate-limit";
import { requireApiV1IntraUser } from "@/lib/intra-user/patient-access";

/** Lista marcações no intervalo [start, end) — query: ?start=ISO&end=ISO */
export async function GET(request: NextRequest) {
  const auth = await requireApiV1Auth(
    request,
    API_V1_READ_RATE_LIMIT,
    "api/v1/agenda/appointments",
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

  const startRaw = request.nextUrl.searchParams.get("start");
  const endRaw = request.nextUrl.searchParams.get("end");
  if (!startRaw || !endRaw) {
    return apiV1Error("INVALID_QUERY", "Parâmetros start e end são obrigatórios (ISO 8601).", 400);
  }

  const result = await listAppointmentsInRangeForUser(
    auth.ctx.dbUser.id,
    { start: startRaw, end: endRaw },
    intra.activeIntraUser,
  );
  if (!result.success) {
    return apiV1Error("AGENDA_LIST_FAILED", result.error, 400);
  }

  return apiV1Ok({
    appointments: (result.data ?? []).map(serializeAppointmentRow),
  });
}

/** Cria marcação — body JSON (patientId ou newPatientName, startAt, endAt, …). */
export async function POST(request: NextRequest) {
  const auth = await requireApiV1Auth(
    request,
    API_V1_WRITE_RATE_LIMIT,
    "api/v1/agenda/appointments:create",
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiV1Error("INVALID_JSON", "Corpo JSON inválido.", 400);
  }

  const result = await createAppointmentForUser(auth.ctx.dbUser.id, body, {
    attendingIntraUserId: intra.activeIntraUser.id,
    activeIntraUser: intra.activeIntraUser,
  });
  if (!result.success) {
    return apiV1Error(
      result.suggestedSlots ? "SCHEDULE_CONFLICT" : "AGENDA_CREATE_FAILED",
      result.error,
      result.suggestedSlots ? 409 : 400,
      result.suggestedSlots
        ? { suggestedSlots: serializeSuggestedSlots(result.suggestedSlots) }
        : undefined,
    );
  }

  return apiV1Ok(
    {
      id: result.data?.id,
      createdPatient: result.createdPatient ?? false,
    },
    { status: 201 },
  );
}
