import type { NextRequest } from "next/server";
import { apiV1Error, apiV1Ok, requireApiV1Auth } from "@/lib/api-v1/response";
import { getPatientDetails } from "@/app/actions/patient";
import { API_V1_READ_RATE_LIMIT } from "@/lib/rate-limit";
import { requireApiV1IntraUser } from "@/lib/intra-user/patient-access";

type RouteParams = { params: Promise<{ patientId: string }> };

function serializePatientDetail(patient: NonNullable<Awaited<ReturnType<typeof getPatientDetails>>["patient"]>) {
  return {
    ...patient,
    lastVisit: patient.lastVisit?.toISOString() ?? null,
    createdAt: patient.createdAt.toISOString(),
    evolutions: patient.evolutions.map((e) => ({
      ...e,
      date: e.date.toISOString(),
    })),
  };
}

/** Ficha do paciente + evoluções — isolamento por userId + Intra User (LGPD). */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireApiV1Auth(
    _request,
    API_V1_READ_RATE_LIMIT,
    "api/v1/patients:detail",
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

  const { patientId } = await params;
  const result = await getPatientDetails(patientId, {
    dbUserId: auth.ctx.dbUser.id,
    activeIntraUser: intra.activeIntraUser,
  });
  if (!result.success || !result.patient) {
    return apiV1Error("PATIENT_NOT_FOUND", result.error ?? "Paciente não encontrado.", 404);
  }

  return apiV1Ok({ patient: serializePatientDetail(result.patient) });
}
