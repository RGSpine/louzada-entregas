import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, LOGIN_RATE_LIMIT } from "@/lib/rate-limit";
import { mergeAuthCookieOptions } from "@/lib/auth/cookie-options";
import {
  PAID_ACCESS_COOKIE,
  PAID_ACCESS_COOKIE_MAX_AGE_SEC,
} from "@/lib/subscription-access";
import { INTRA_USER_COOKIE } from "@/lib/intra-user/constants";
import { safeMarketplaceRedirect } from "@/lib/marketplace/paths";
import { ensureB2cPatientAndPrimaryProfile } from "@/lib/b2c/patient-session";
import { isMapInviteToken, redeemMapInviteForAuthUser } from "@/lib/b2c/professional-link";
import { MAP_INVITE_COOKIE } from "@/lib/b2c/map-invite-cookie";

const LoginBodySchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(6).max(200),
  redirect: z.string().max(400).optional(),
  inviteToken: z.string().trim().max(80).optional(),
});

type PendingCookie = {
  name: string;
  value: string;
  options?: CookieOptions;
};

/**
 * Login via Route Handler — Set-Cookie no Response (Safari iOS / in-app).
 * Preferir este endpoint em vez de Server Action no iPhone.
 */
export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { success: false, error: "Autenticação não configurada." },
      { status: 503 },
    );
  }

  const raw = await request.json().catch(() => null);
  const parsed = LoginBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "E-mail ou senha inválidos." },
      { status: 400 },
    );
  }
  const email = parsed.data.email.trim().toLowerCase();
  const password = parsed.data.password;
  const marketplaceNext = safeMarketplaceRedirect(parsed.data.redirect);

  const rateCheck = await enforceRateLimit(`login:${email}`, LOGIN_RATE_LIMIT);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: `Muitas tentativas de login. Tente novamente em ${rateCheck.resetIn} segundos.`,
      },
      { status: 429 },
    );
  }

  // Jar explícito: ao trocar o NextResponse.json final, reaplicamos opções completas
  // (httpOnly/maxAge). getAll() do Response só devolve name/value.
  const pendingCookies: PendingCookie[] = [];
  let response = NextResponse.json({ success: false, error: "init" });

  const applyPending = (res: NextResponse) => {
    for (const c of pendingCookies) {
      res.cookies.set(c.name, c.value, mergeAuthCookieOptions(c.options));
    }
  };

  const cookiesForSupabase = () => {
    const byName = new Map<string, { name: string; value: string }>();
    for (const c of request.cookies.getAll()) {
      byName.set(c.name, { name: c.name, value: c.value });
    }
    for (const c of pendingCookies) {
      byName.set(c.name, { name: c.name, value: c.value });
    }
    return Array.from(byName.values());
  };

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookieOptions: mergeAuthCookieOptions(),
    cookies: {
      getAll() {
        return cookiesForSupabase();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          pendingCookies.push({ name, value, options });
          response.cookies.set(name, value, mergeAuthCookieOptions(options));
        });
      },
    },
  });

  const { data, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError || !data.user) {
    const errMsg = signInError?.message ?? "";
    if (errMsg.includes("Invalid login credentials")) {
      return NextResponse.json(
        { success: false, error: "E-mail ou senha incorretos." },
        { status: 401 },
      );
    }
    if (errMsg.includes("Email not confirmed")) {
      return NextResponse.json(
        {
          success: false,
          error: "Confirme seu e-mail antes de fazer login. Verifique sua caixa de entrada.",
        },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { success: false, error: errMsg || "Erro ao fazer login." },
      { status: 401 },
    );
  }

  let dbUser = await prisma.user.findFirst({
    where: {
      OR: [
        { authUserId: data.user.id },
        { email: data.user.email ?? email },
        { id: data.user.id },
      ],
    },
    select: {
      id: true,
      email: true,
      isInfluencer: true,
      stripeSubscriptionId: true,
      authUserId: true,
    },
  });

  const audienceMeta = data.user.user_metadata?.audience;
  const isPatientAudience = audienceMeta === "patient";
  const b2cPatient = await prisma.patient.findUnique({
    where: { authUserId: data.user.id },
    select: { id: true },
  });

  // Paciente B2C: não cria User profissional nem manda para /dashboard.
  if (!dbUser && (marketplaceNext || isPatientAudience || b2cPatient)) {
    response = NextResponse.json({
      success: true,
      needsCheckout: false,
      redirectTo: marketplaceNext ?? "/mapa-saude",
      audience: "patient",
    });
    applyPending(response);
    const fromBody = parsed.data.inviteToken ?? "";
    const fromCookie = request.cookies.get(MAP_INVITE_COOKIE)?.value ?? "";
    const inviteToken = isMapInviteToken(fromBody)
      ? fromBody
      : isMapInviteToken(fromCookie)
        ? fromCookie
        : "";
    if (inviteToken) {
      try {
        await ensureB2cPatientAndPrimaryProfile(data.user);
        const linked = await redeemMapInviteForAuthUser(data.user.id, inviteToken);
        if (linked) {
          response.cookies.set(MAP_INVITE_COOKIE, "", {
            ...mergeAuthCookieOptions(),
            httpOnly: true,
            maxAge: 0,
            path: "/",
          });
        }
      } catch {
        // O login segue mesmo se o convite não puder ser aplicado.
      }
    }
    return response;
  }

  if (!dbUser) {
    try {
      dbUser = await prisma.user.create({
        data: {
          id: data.user.id,
          authUserId: data.user.id,
          email: data.user.email ?? email,
          name:
            (data.user.user_metadata?.name as string | undefined) ||
            (data.user.email ?? email).split("@")[0] ||
            "Usuário",
          plan: "CLINICA",
          accountStatus: "ACTIVE",
          basicoCheckoutRequired: false,
        },
        select: {
          id: true,
          email: true,
          isInfluencer: true,
          stripeSubscriptionId: true,
          authUserId: true,
        },
      });
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Erro ao sincronizar conta. Entre em contato com o suporte.",
        },
        { status: 500 },
      );
    }
  }

  if (!dbUser.authUserId && data.user.id) {
    try {
      await prisma.user.update({
        where: { id: dbUser.id },
        data: { authUserId: data.user.id },
      });
    } catch {
      // não bloqueia login
    }
  }

  const needsCheckout = false;
  const redirectTo = "/dashboard";

  response = NextResponse.json({
    success: true,
    needsCheckout,
    redirectTo,
  });
  applyPending(response);

  response.cookies.set(PAID_ACCESS_COOKIE, "1", {
    ...mergeAuthCookieOptions(),
    httpOnly: true,
    maxAge: PAID_ACCESS_COOKIE_MAX_AGE_SEC,
  });
  response.cookies.set(INTRA_USER_COOKIE, "", {
    ...mergeAuthCookieOptions(),
    httpOnly: true,
    maxAge: 0,
  });

  return response;
}
