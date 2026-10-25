import type { NextRequest } from "next/server";
import { apiV1Error, apiV1Ok, requireApiV1AiAuth } from "@/lib/api-v1/response";
import { processAgendaIntakeForUser } from "@/server/services/agenda-intake";
import { requireApiV1IntraUser } from "@/lib/intra-user/patient-access";

export const maxDuration = 300;

/** Marcar, remarcar, desmarcar ou renomear por áudio (intake IA). Foto não é suportada. */
export async function POST(request: NextRequest) {
  const auth = await requireApiV1AiAuth(request, "api/v1/agenda:intake");
  if (!auth.ok) return auth.response;

  const intra = await requireApiV1IntraUser(
    request,
    auth.ctx.dbUser.id,
    auth.ctx.dbUser.plan,
  );
  if (!intra.ok) {
    return apiV1Error("PROFILE_REQUIRED", intra.error, 403);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return apiV1Error("INVALID_FORM", "FormData inválido.", 400);
  }

  const user = {
    id: auth.ctx.dbUser.id,
    plan: auth.ctx.dbUser.plan,
    email: auth.ctx.dbUser.email,
    sessionEmail: auth.ctx.email,
    isInfluencer: auth.ctx.dbUser.isInfluencer,
  };

  const result = await processAgendaIntakeForUser(user, formData, {
    activeIntraUser: intra.activeIntraUser,
  });
  if (!result.ok) {
    const code =
      result.status === 403
        ? "PLAN_LIMIT"
        : result.status === 422
          ? "AGENDA_INTAKE_AMBIGUOUS"
          : "AGENDA_INTAKE_FAILED";
    return apiV1Error(code, result.error, result.status, {
      summary: result.summary ?? null,
      confidenceOverall: result.confidenceOverall ?? null,
    });
  }

  return apiV1Ok({
    action: result.action,
    created: result.created,
    rescheduled: result.rescheduled,
    cancelled: result.cancelled,
    renamed: result.renamed,
    noShows: result.noShows,
    errors: result.errors,
    newPatientNames: result.newPatientNames,
    issues: result.issues,
    summary: result.summary,
    confidenceOverall: result.confidenceOverall,
  });
}
