import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export const GOOGLE_OAUTH_LINK_COOKIE = "google_oauth_link_uid";

/** Escopos do login/cadastro parcial via Supabase (nome + e-mail). */
export const GOOGLE_SIGNIN_SCOPES = "openid email profile";

/** Escopos da conexão Agenda (NextAuth) — identidade + Calendar. */
export const GOOGLE_OAUTH_REQUESTED_SCOPES =
  `${GOOGLE_SIGNIN_SCOPES} https://www.googleapis.com/auth/calendar.events`;

export function scopeIncludesGoogleCalendar(scope: string | null | undefined): boolean {
  return Boolean(scope?.includes("calendar"));
}

export type GoogleOAuthEnvDiagnostics = {
  configured: boolean;
  hasGoogleClientId: boolean;
  hasGoogleClientSecret: boolean;
  hasAuthSecret: boolean;
  authUrl: string | null;
};

export function getGoogleOAuthEnvDiagnostics(): GoogleOAuthEnvDiagnostics {
  const hasGoogleClientId = Boolean(process.env.AUTH_GOOGLE_ID?.trim());
  const hasGoogleClientSecret = Boolean(process.env.AUTH_GOOGLE_SECRET?.trim());
  const hasAuthSecret = Boolean(process.env.AUTH_SECRET?.trim());
  const authUrl =
    process.env.AUTH_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    null;

  return {
    configured: hasGoogleClientId && hasGoogleClientSecret && hasAuthSecret,
    hasGoogleClientId,
    hasGoogleClientSecret,
    hasAuthSecret,
    authUrl,
  };
}

export function isGoogleOAuthConfigured(): boolean {
  return getGoogleOAuthEnvDiagnostics().configured;
}

export async function setGoogleOAuthLinkCookie(prismaUserId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(GOOGLE_OAUTH_LINK_COOKIE, prismaUserId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 10 * 60,
    path: "/",
  });
}

export async function peekGoogleOAuthLinkCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(GOOGLE_OAUTH_LINK_COOKIE)?.value ?? null;
}

export async function consumeGoogleOAuthLinkCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(GOOGLE_OAUTH_LINK_COOKIE)?.value ?? null;
  if (value) {
    cookieStore.delete(GOOGLE_OAUTH_LINK_COOKIE);
  }
  return value;
}

type GoogleTokens = {
  access_token?: string | null;
  refresh_token?: string | null;
  expires_at?: number | null;
  scope?: string | null;
  token_type?: string | null;
  id_token?: string | null;
};

/**
 * Associa a conta OAuth Google ao utilizador Prisma da sessão Supabase
 * (evita duplicar User quando o login principal é e-mail/senha).
 */
export async function linkGoogleAccountToPrismaUser(params: {
  targetUserId: string;
  oauthUserId: string;
  providerAccountId: string;
  tokens: GoogleTokens;
}): Promise<void> {
  const { targetUserId, oauthUserId, providerAccountId, tokens } = params;

  const existing = await prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: "google",
        providerAccountId,
      },
    },
  });

  const tokenData = {
    access_token: tokens.access_token ?? undefined,
    refresh_token: tokens.refresh_token ?? undefined,
    expires_at: tokens.expires_at ?? undefined,
    scope: tokens.scope ?? undefined,
    token_type: tokens.token_type ?? undefined,
    id_token: tokens.id_token ?? undefined,
  };

  if (existing) {
    await prisma.account.update({
      where: { id: existing.id },
      data: {
        userId: targetUserId,
        access_token: tokenData.access_token ?? existing.access_token ?? undefined,
        refresh_token: tokenData.refresh_token ?? existing.refresh_token ?? undefined,
        expires_at: tokenData.expires_at ?? existing.expires_at ?? undefined,
        scope:
          (tokens.scope?.trim() ? tokens.scope : null) ??
          existing.scope ??
          GOOGLE_OAUTH_REQUESTED_SCOPES,
        token_type: tokenData.token_type ?? existing.token_type ?? undefined,
        id_token: tokenData.id_token ?? existing.id_token ?? undefined,
      },
    });
  } else {
    await prisma.account.create({
      data: {
        userId: targetUserId,
        type: "oauth",
        provider: "google",
        providerAccountId,
        ...tokenData,
        scope: tokens.scope?.trim() ? tokens.scope : GOOGLE_OAUTH_REQUESTED_SCOPES,
      },
    });
  }

  if (oauthUserId !== targetUserId) {
    const orphan = await prisma.user.findUnique({
      where: { id: oauthUserId },
      include: {
        accounts: true,
        patients: { select: { id: true }, take: 1 },
        appointments: { select: { id: true }, take: 1 },
      },
    });
    if (
      orphan &&
      orphan.accounts.length === 0 &&
      orphan.patients.length === 0 &&
      orphan.appointments.length === 0
    ) {
      await prisma.user.delete({ where: { id: oauthUserId } }).catch(() => {
        /* ignorar se ainda houver dependências */
      });
    }
  }
}
