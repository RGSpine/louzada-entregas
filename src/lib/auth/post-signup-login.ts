/**
 * Credenciais temporárias pós-cadastro para pré-preencher o login após o Stripe.
 * Só sessionStorage (mesma aba); limpar após uso.
 */
export const POST_SIGNUP_LOGIN_KEY = "ai_evolui_post_signup_login";

export type PostSignupLoginPayload = {
  email: string;
  password: string;
  createdAt: number;
};

const MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2h

export function stashPostSignupLogin(email: string, password: string): void {
  if (typeof window === "undefined") return;
  const payload: PostSignupLoginPayload = {
    email: email.trim().toLowerCase(),
    password,
    createdAt: Date.now(),
  };
  sessionStorage.setItem(POST_SIGNUP_LOGIN_KEY, JSON.stringify(payload));
}

export function readPostSignupLogin(): PostSignupLoginPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(POST_SIGNUP_LOGIN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PostSignupLoginPayload;
    if (!parsed?.email || !parsed?.password) return null;
    if (Date.now() - (parsed.createdAt || 0) > MAX_AGE_MS) {
      sessionStorage.removeItem(POST_SIGNUP_LOGIN_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPostSignupLogin(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(POST_SIGNUP_LOGIN_KEY);
}
