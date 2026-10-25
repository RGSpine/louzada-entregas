import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { syncGoogleAuthUser } from "@/lib/auth/sync-google-auth-user";
import { isGoogleAuthAllowlistedEmail } from "@/lib/auth/google-auth-allowlist";

function safeNextPath(raw: string | null): string {
  if (raw?.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/dashboard";
}

/**
 * Callback OAuth Supabase (Google). Troca `code` por sessão e roteia cadastro parcial ou login.
 * Contas fora da allowlist de teste são encerradas imediatamente.
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeNextPath(requestUrl.searchParams.get("next"));
  const intent = requestUrl.searchParams.get("intent") === "signup" ? "signup" : "login";

  if (!code) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "oauth");
    return NextResponse.redirect(loginUrl);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error || !data.user) {
      console.error("[auth/callback] exchangeCodeForSession:", error?.message);
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "oauth");
      return NextResponse.redirect(loginUrl);
    }

    if (!isGoogleAuthAllowlistedEmail(data.user.email)) {
      await supabase.auth.signOut();
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "oauth_restricted");
      return NextResponse.redirect(loginUrl);
    }

    const sync = await syncGoogleAuthUser(data.user);

    if (!sync.profileComplete) {
      const completeUrl = new URL("/register/complete", request.url);
      completeUrl.searchParams.set("next", next);
      if (intent === "signup" || sync.isNewUser) {
        completeUrl.searchParams.set("from", "signup");
      }
      return NextResponse.redirect(completeUrl);
    }

    const successUrl = new URL("/auth/oauth-success", request.url);
    successUrl.searchParams.set("next", next);
    return NextResponse.redirect(successUrl);
  } catch (err) {
    console.error("[auth/callback]", err);
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "oauth");
    return NextResponse.redirect(loginUrl);
  }
}
