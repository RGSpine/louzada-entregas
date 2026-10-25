import { prisma } from "@/lib/prisma";
import type { User } from "@prisma/client";
import type { User as SupabaseAuthUser } from "@supabase/supabase-js";
import {
  effectivePlanForFeatures,
  getPlanLimits,
  resolveSessionEmail,
  type PlanType,
} from "@/lib/plan-limits";

/** Contexto autenticado resolvido no servidor (web, PWA, mobile, desktop). */
export type AuthenticatedContext = {
  authUserId: string;
  email: string | null;
  dbUser: Pick<
    User,
    | "id"
    | "email"
    | "name"
    | "role"
    | "isBlocked"
    | "plan"
    | "isInfluencer"
    | "stripeSubscriptionId"
    | "basicoCheckoutRequired"
    | "currentPeriodEnd"
    | "profession"
    | "phone"
    | "councilType"
    | "councilNumber"
    | "officeAddress"
    | "clinicLogoUrl"
  >;
  effectivePlan: PlanType;
};

const dbUserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  isBlocked: true,
  plan: true,
  isInfluencer: true,
  stripeSubscriptionId: true,
  basicoCheckoutRequired: true,
  currentPeriodEnd: true,
  profession: true,
  phone: true,
  councilType: true,
  councilNumber: true,
  officeAddress: true,
  clinicLogoUrl: true,
} as const;

/**
 * Resolve o registro Prisma a partir do usuário Supabase Auth.
 * Usa authUserId (preferencial) ou email como fallback — padrão já usado no produto.
 */
export async function resolveDbUserFromSupabaseAuth(
  authUser: SupabaseAuthUser,
): Promise<AuthenticatedContext | null> {
  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [{ authUserId: authUser.id }, { email: authUser.email ?? "" }],
    },
    select: dbUserSelect,
  });

  if (!dbUser) {
    return null;
  }

  const email = resolveSessionEmail(authUser.email, dbUser.email);
  const effectivePlan = effectivePlanForFeatures(dbUser.plan, dbUser.isInfluencer);

  return {
    authUserId: authUser.id,
    email,
    dbUser,
    effectivePlan,
  };
}

export function getPlanLimitsForContext(ctx: AuthenticatedContext) {
  return getPlanLimits(ctx.dbUser.plan, ctx.email, ctx.dbUser.isInfluencer);
}
