import { NextRequest, NextResponse } from "next/server";
import { signIn } from "@/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import {
  getGoogleOAuthEnvDiagnostics,
  isGoogleOAuthConfigured,
  setGoogleOAuthLinkCookie,
} from "@/lib/google-oauth-link";
import { canUseGoogleCalendarIntegration } from "@/lib/google-calendar-access";

function agendaUrl(request: NextRequest, query?: Record<string, string>): URL {
  const url = new URL("/dashboard/agenda", request.url);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
  }
  return url;
}

/**
 * Inicia OAuth Google amarrado ao utilizador Prisma da sessão Supabase atual.
 * Auth.js v5: não usar GET /api/auth/signin/google — chamar signIn() no servidor.
 */
export async function GET(request: NextRequest) {
  if (!isGoogleOAuthConfigured()) {
    const diag = getGoogleOAuthEnvDiagnostics();
    console.error(
      JSON.stringify({
        event: "google.oauth.misconfigured",
        ...diag,
      }),
    );
    return NextResponse.redirect(
      agendaUrl(request, { google: "unconfigured" }),
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
    error,
  } = await supabase.auth.getUser();

  if (error || !authUser) {
    const login = new URL("/login", request.url);
    login.searchParams.set("callbackUrl", "/dashboard/agenda");
    return NextResponse.redirect(login);
  }

  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [{ authUserId: authUser.id }, { email: authUser.email ?? "" }],
    },
    select: {
      id: true,
      email: true,
      googleCalendarManualApprovedAt: true,
    },
  });

  if (!dbUser) {
    return NextResponse.redirect(agendaUrl(request, { google: "no_user" }));
  }

  if (
    !canUseGoogleCalendarIntegration(dbUser.email, {
      googleCalendarManualApprovedAt: dbUser.googleCalendarManualApprovedAt,
    })
  ) {
    return NextResponse.redirect(agendaUrl(request, { google: "integration_disabled" }));
  }

  await setGoogleOAuthLinkCookie(dbUser.id);

  await signIn("google", {
    redirectTo: "/dashboard/agenda?google=connected",
  });
}
