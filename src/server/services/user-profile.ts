import type { AuthenticatedContext } from "@/lib/auth/session-user";
import { getPlanLimitsForContext } from "@/lib/auth/session-user";
import { prisma } from "@/lib/prisma";
import { effectiveMonthlyEvolutionCount } from "@/lib/plan-usage-banner";
import { planSupportsIntraUsers } from "@/lib/intra-user/constants";
import { normalizePlanTier } from "@/lib/plan-tier";
import { ensureOwnerIntraUser } from "@/lib/intra-user/context";

const WEB_BILLING_URL = "http://localhost:3000/dashboard/planos";

export type ApiUserProfilePayload = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  profession: string | null;
  councilType: string | null;
  councilNumber: string | null;
  officeAddress: string | null;
  clinicLogoUrl: string | null;
  plan: {
    stored: string | null;
    effective: string;
    limits: ReturnType<typeof getPlanLimitsForContext>;
  };
  usage: {
    evolutionsUsedThisMonth: number;
    evolutionsLimit: number;
    patientsUsed: number;
    patientsLimit: number;
  };
  /**
   * Assinatura gerenciada apenas na web (política App Store / Play Store).
   * Apps nativos reconhecem o plano; não vendem in-app.
   */
  billing: {
    managedOnWeb: true;
    subscriptionUrl: string;
    hasActiveSubscription: boolean;
    currentPeriodEnd: string | null;
  };
  /**
   * Perfis Intra User (Consultório/Clínica). Apps nativos enviam
   * `X-Intra-User-Id` (+ PIN ADMIN) nas rotas v1.
   */
  team: {
    supported: boolean;
    requiresSelection: boolean;
    profiles: Array<{
      id: string;
      name: string;
      color: string;
      role: "ADMIN" | "MEMBER";
      isOwner: boolean;
      hasPin: boolean;
    }>;
  };
};

export async function buildApiUserProfile(
  ctx: AuthenticatedContext,
): Promise<ApiUserProfilePayload> {
  const limits = getPlanLimitsForContext(ctx);
  const usageRow = await prisma.user.findUnique({
    where: { id: ctx.dbUser.id },
    select: {
      evolutionCount: true,
      evolutionCountResetAt: true,
      patientCount: true,
    },
  });

  const evolutionsUsedThisMonth = effectiveMonthlyEvolutionCount(
    usageRow?.evolutionCount ?? 0,
    usageRow?.evolutionCountResetAt ?? null,
  );

  const tier = normalizePlanTier(ctx.dbUser.plan);
  const teamSupported = tier ? planSupportsIntraUsers(tier) : false;
  let teamProfiles: ApiUserProfilePayload["team"]["profiles"] = [];
  if (teamSupported) {
    let rows = await prisma.intraUser.findMany({
      where: { userId: ctx.dbUser.id },
      orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        color: true,
        role: true,
        isOwner: true,
        pinHash: true,
      },
    });
    if (rows.length === 0) {
      await ensureOwnerIntraUser(ctx.dbUser.id, ctx.dbUser.name ?? "Titular");
      rows = await prisma.intraUser.findMany({
        where: { userId: ctx.dbUser.id },
        orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }],
        select: {
          id: true,
          name: true,
          color: true,
          role: true,
          isOwner: true,
          pinHash: true,
        },
      });
    }
    teamProfiles = rows.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      role: r.role,
      isOwner: r.isOwner,
      hasPin: r.role === "ADMIN" && Boolean(r.pinHash),
    }));
  }

  return {
    id: ctx.dbUser.id,
    name: ctx.dbUser.name,
    email: ctx.email,
    phone: ctx.dbUser.phone,
    profession: ctx.dbUser.profession,
    councilType: ctx.dbUser.councilType,
    councilNumber: ctx.dbUser.councilNumber,
    officeAddress: ctx.dbUser.officeAddress,
    clinicLogoUrl: ctx.dbUser.clinicLogoUrl,
    plan: {
      stored: ctx.dbUser.plan,
      effective: ctx.effectivePlan,
      limits,
    },
    usage: {
      evolutionsUsedThisMonth,
      evolutionsLimit: limits.maxEvolutions,
      patientsUsed: usageRow?.patientCount ?? 0,
      patientsLimit: limits.maxPatients,
    },
    billing: {
      managedOnWeb: true,
      subscriptionUrl: WEB_BILLING_URL,
      hasActiveSubscription: Boolean(ctx.dbUser.stripeSubscriptionId),
      currentPeriodEnd: ctx.dbUser.currentPeriodEnd?.toISOString() ?? null,
    },
    team: {
      supported: teamSupported,
      requiresSelection: teamSupported && teamProfiles.length > 1,
      profiles: teamProfiles,
    },
  };
}
