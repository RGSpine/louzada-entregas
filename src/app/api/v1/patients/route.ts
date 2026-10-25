import type { NextRequest } from "next/server";
import { apiV1Error, apiV1Ok, requireApiV1Auth } from "@/lib/api-v1/response";
import { listPatientsForUser } from "@/server/services/patients";
import { API_V1_READ_RATE_LIMIT } from "@/lib/rate-limit";
import { requireApiV1IntraUser } from "@/lib/intra-user/patient-access";

/** Lista pacientes do profissional — isolamento por userId + Intra User (LGPD). */
export async function GET(request: NextRequest) {
  const auth = await requireApiV1Auth(
    request,
    API_V1_READ_RATE_LIMIT,
    "api/v1/patients",
  );
  if (!auth.ok) {
    return auth.response;
  }

  const intra = await requireApiV1IntraUser(
    request,
    auth.ctx.dbUser.id,
    auth.ctx.dbUser.plan,
  );
  if (!intra.ok) {
    return apiV1Error("PROFILE_REQUIRED", intra.error, 403);
  }

  const q = request.nextUrl.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const patients = await listPatientsForUser(
    auth.ctx.dbUser.id,
    intra.activeIntraUser,
  );
  const filtered = q
    ? patients.filter((p) => p.name.toLowerCase().includes(q))
    : patients;
  return apiV1Ok({
    patients: filtered.map((p) => ({
      id: p.id,
      name: p.name,
      lastEvolutionDate: p.lastEvolutionDate?.toISOString() ?? null,
      evolutionCount: p.evolutionCount,
    })),
  });
}
