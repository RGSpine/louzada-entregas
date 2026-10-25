import type { NextRequest } from "next/server";
import { apiV1Error, apiV1Ok, requireApiV1Auth } from "@/lib/api-v1/response";
import { listAppointmentPatientsForUser } from "@/server/services/appointments";
import { API_V1_READ_RATE_LIMIT } from "@/lib/rate-limit";
import { requireApiV1IntraUser } from "@/lib/intra-user/patient-access";

/** Pacientes disponíveis para agendamento (picker) — escopo Intra User. */
export async function GET(request: NextRequest) {
  const auth = await requireApiV1Auth(
    request,
    API_V1_READ_RATE_LIMIT,
    "api/v1/agenda/patients",
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

  const result = await listAppointmentPatientsForUser(
    auth.ctx.dbUser.id,
    intra.activeIntraUser,
  );
  if (!result.success) {
    return apiV1Ok({ patients: [] });
  }

  return apiV1Ok({ patients: result.data ?? [] });
}
