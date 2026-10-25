import { prisma } from "@/lib/prisma";

/** Mensagem quando o utilizador revogou o acesso em myaccount.google.com/permissions */
export const GOOGLE_OAUTH_REVOKED_MESSAGE =
  "O acesso ao Google foi revogado ou expirou. Clique em Reconectar Google para autorizar novamente.";

export function isGoogleOAuthRevokedError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;

  const e = err as {
    code?: number;
    message?: string;
    response?: { status?: number; data?: { error?: string; error_description?: string } };
  };

  const status = e.response?.status ?? e.code;
  const oauthError = e.response?.data?.error;
  const description = (e.response?.data?.error_description ?? e.message ?? "").toLowerCase();

  if (status === 401) return true;
  if (oauthError === "invalid_grant") return true;
  if (description.includes("invalid authentication credentials")) return true;
  if (description.includes("invalid_grant")) return true;
  if (description.includes("token has been expired or revoked")) return true;
  if (description.includes("revoked")) return true;

  return false;
}

/** Remove tokens OAuth inválidos/revogados — força novo fluxo Conectar Google. */
export async function invalidateGoogleOAuthAccount(userId: string): Promise<void> {
  await prisma.account.updateMany({
    where: { userId, provider: "google" },
    data: {
      access_token: null,
      refresh_token: null,
      expires_at: null,
      scope: null,
      token_type: null,
      id_token: null,
    },
  });
}

export async function handleGoogleOAuthRevoked(userId: string, err: unknown): Promise<boolean> {
  if (!isGoogleOAuthRevokedError(err)) return false;
  await invalidateGoogleOAuthAccount(userId);
  return true;
}
