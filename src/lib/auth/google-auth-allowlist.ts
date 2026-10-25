/**
 * Contas de teste internas para OAuth Google:
 * - login/cadastro parcial (Supabase)
 * - integração Agenda / Calendar (NextAuth)
 * enquanto o produto não libera Google para todos os profissionais.
 */
export const GOOGLE_AUTH_TEST_EMAILS = [
  "robertoguanaes@gmail.com",
  "contato.ai.evolui@gmail.com",
] as const;

export function isGoogleAuthAllowlistedEmail(
  email: string | null | undefined,
): boolean {
  if (typeof email !== "string") return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return (GOOGLE_AUTH_TEST_EMAILS as readonly string[]).includes(normalized);
}
