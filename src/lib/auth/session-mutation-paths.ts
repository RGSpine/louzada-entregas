/**
 * Rotas que elas próprias criam/renovam a sessão Supabase.
 * O proxy NÃO deve chamar getUser() aqui: um refresh_token stale
 * apaga os Set-Cookie do login e o /refresh devolve 401.
 */
const AUTH_SESSION_MUTATION_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/refresh",
  "/api/auth/exchange",
]);

export function isAuthSessionMutationPath(pathname: string): boolean {
  const path = pathname.split("?")[0] ?? pathname;
  return AUTH_SESSION_MUTATION_PATHS.has(path);
}
