import type { NextRequest } from "next/server";
import { reviseClinicalDocumentDraft } from "@/app/actions/generated-documents";
import { apiV1Error, apiV1Ok, requireApiV1Session } from "@/lib/api-v1/response";
import { requireApiV1IntraUser } from "@/lib/intra-user/patient-access";

/** Revisão do rascunho com IA (modelos, evoluções ou gramática). */
export async function POST(request: NextRequest) {
  // Billing limit fica na Server Action (evita contagem dupla).
  const auth = await requireApiV1Session(request);
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

  const user = {
    id: auth.ctx.dbUser.id,
    plan: auth.ctx.dbUser.plan,
    email: auth.ctx.dbUser.email,
    sessionEmail: auth.ctx.email,
    isInfluencer: auth.ctx.dbUser.isInfluencer,
    name: auth.ctx.dbUser.name,
  };

  const result = await reviseClinicalDocumentDraft(body, user, {
    activeIntraUser: intra.activeIntraUser,
  });
  if ("error" in result) {
    return apiV1Error("DOCUMENT_REVISE_FAILED", result.error, 400);
  }

  return apiV1Ok({
    body: result.body,
    usedEvolutionContext: result.usedEvolutionContext ?? false,
  });
}
