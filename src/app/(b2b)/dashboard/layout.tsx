import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { DashboardSubnavChrome } from "@/components/dashboard/DashboardSubnavChrome";
import { PlanAccessGateClient } from "@/components/dashboard/PlanAccessGateClient";
import { PendingCheckoutGate } from "@/components/dashboard/PendingCheckoutGate";
import { getPlanAccessGate } from "@/app/actions/plan-access";
import { IntraUserProfileGate } from "@/components/dashboard/team/IntraUserProfileGate";
import { IntraUserSetupScreen } from "@/components/dashboard/team/IntraUserSetupScreen";
import { LabSharedRefresh } from "@/components/dashboard/logistics/LabSharedRefresh";
import { getIntraUserContext } from "@/lib/intra-user/context";
import { isProfessionalProfileComplete } from "@/lib/auth/google-profile";
import {
  ACCESS_SESSION_COOKIE,
  getMaxConcurrentSessionsForPlan,
  isAccessSessionActive,
  registerAccessSession,
} from "@/lib/access-session";
import { resolveSessionEmail } from "@/lib/plan-limits";
import { needsBasicoCheckout } from "@/lib/basico-plan";

/** Painel autenticado: não pré-renderizar no build da Vercel. */
export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !authUser) {
    redirect("/login");
  }

  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [
        { authUserId: authUser.id },
        { email: authUser.email ?? "" },
      ],
    },
    select: {
      id: true,
      email: true,
      plan: true,
      isInfluencer: true,
      isBlocked: true,
      name: true,
      profession: true,
      councilType: true,
      councilNumber: true,
      stripeSubscriptionId: true,
      basicoCheckoutRequired: true,
    },
  });

  if (!dbUser) {
    redirect("/register/complete");
  }

  if (!isProfessionalProfileComplete(dbUser)) {
    redirect("/register/complete");
  }

  if (dbUser.isBlocked) {
    redirect("/login?reason=blocked");
  }

  const headerStore = await headers();
  // Só confiar em x-pathname (injetado pelo proxy) para hard-block server.
  // Fallback via referer/next-url em request de /planos gerava pathname falso →
  // redirect("/dashboard/planos") em loop de HTTP 307.
  const proxyPath = headerStore.get("x-pathname")?.trim() ?? "";
  const proxyOnPlanos =
    proxyPath === "/dashboard/planos" || proxyPath.startsWith("/dashboard/planos/");
  // Acesso ao produto: só Stripe (ou influenciador). O texto de `plan` NÃO libera.
  const checkoutPending = needsBasicoCheckout({
    basicoCheckoutRequired: dbUser.basicoCheckoutRequired,
    stripeSubscriptionId: dbUser.stripeSubscriptionId,
    isInfluencer: dbUser.isInfluencer,
    plan: dbUser.plan,
  });

  const sessionEmail = resolveSessionEmail(authUser.email, dbUser.email);

  // Hard-block: sem Stripe → só planos. Nunca ejetar /planos por nome de plano.
  // Sem x-pathname: PendingCheckoutGate + cookie aievolui_paid cobrem sem 307 loop.
  if (
    checkoutPending &&
    proxyPath.startsWith("/dashboard") &&
    !proxyOnPlanos
  ) {
    redirect("/dashboard");
  }
  const maxSessions = getMaxConcurrentSessionsForPlan(
    dbUser.plan,
    sessionEmail,
    dbUser.isInfluencer,
  );
  if (!checkoutPending && Number.isFinite(maxSessions)) {
    const deviceId = (await cookies()).get(ACCESS_SESSION_COOKIE)?.value?.trim();
    if (deviceId) {
      const active = await isAccessSessionActive({ userId: dbUser.id, deviceId });
      if (!active) {
        const registered = await registerAccessSession({
          userId: dbUser.id,
          deviceId,
          userAgent: headerStore.get("user-agent"),
          claimSlot: true,
        });
        if (!registered.ok && registered.reason === "limit_exceeded") {
          redirect("/login?reason=access_limit");
        }
      }
    }
  }

  // Checkout pendente: shell mínimo SEM sidebar/menu.
  // O chrome completo prefetcheia Links para /dashboard/*; o hard-block abaixo
  // responde com redirect → /planos, e o App Router remonta a página em loop
  // (tela branca + GET /dashboard/planos infinito).
  if (checkoutPending) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <PendingCheckoutGate>{children}</PendingCheckoutGate>
      </div>
    );
  }

  const planAccessGate = await getPlanAccessGate();
  const intraCtx = await getIntraUserContext();

  const activeIntraUser = intraCtx?.activeIntraUser
    ? {
        id: intraCtx.activeIntraUser.id,
        name: intraCtx.activeIntraUser.name,
        color: intraCtx.activeIntraUser.color,
        role: intraCtx.activeIntraUser.role,
      }
    : null;
  const isTeamPlan = Boolean(intraCtx?.isClinica);
  const canSwitchIntraUser = Boolean(
    isTeamPlan && (intraCtx?.intraUserCount ?? 0) > 1,
  );

  const product = intraCtx && !intraCtx.teamSetupCompleted ? (
    <IntraUserSetupScreen />
  ) : intraCtx?.requiresProfileSelection ? (
    <IntraUserProfileGate profiles={intraCtx.profiles} />
  ) : (
    children
  );

  return (
    <DashboardSubnavChrome
      activeIntraUser={activeIntraUser}
      isTeamPlan={isTeamPlan}
      canSwitchIntraUser={canSwitchIntraUser}
    >
      {planAccessGate ? <PlanAccessGateClient gate={planAccessGate} /> : null}
      <LabSharedRefresh />
      {product}
    </DashboardSubnavChrome>
  );
}
