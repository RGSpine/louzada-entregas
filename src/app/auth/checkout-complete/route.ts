import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/**
 * Após o Stripe Checkout: encerra a sessão temporária do cadastro e envia
 * o usuário ao Login com e-mail pré-preenchido (senha vem do sessionStorage).
 */
export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
  const emailParam = (request.nextUrl.searchParams.get("email") ?? "").trim();

  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  } catch (err) {
    console.warn("[checkout-complete] signOut falhou:", err);
  }

  const loginUrl = new URL("/login", appUrl);
  loginUrl.searchParams.set("checkout", "success");
  if (emailParam) {
    loginUrl.searchParams.set("email", emailParam);
  }

  return NextResponse.redirect(loginUrl);
}
