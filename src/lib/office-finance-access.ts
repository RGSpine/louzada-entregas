import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { canUseOfficeFinance } from "@/lib/plan-limits";

export const OFFICE_FINANCE_PLAN_ERROR =
  "Consultório financeiro disponível no plano Premium ou superior. Faça upgrade para continuar.";

export type OfficeFinanceAccessResult =
  | { ok: true; userId: string }
  | { ok: false; error: string };

/** Gate server-side: autenticação + plano Premium/Consultório/Clínica. */
export async function requireOfficeFinanceUser(): Promise<OfficeFinanceAccessResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !authUser) {
    return { ok: false, error: "Não autenticado." };
  }

  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [{ authUserId: authUser.id }, { email: authUser.email ?? "" }],
    },
    select: { id: true, plan: true, email: true, isInfluencer: true },
  });

  if (!dbUser?.id) {
    return { ok: false, error: "Usuário não encontrado." };
  }

  if (!canUseOfficeFinance(dbUser.plan, dbUser.email, dbUser.isInfluencer)) {
    return { ok: false, error: OFFICE_FINANCE_PLAN_ERROR };
  }

  return { ok: true, userId: dbUser.id };
}
