import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { AuthExchangeSchema } from "@/lib/auth-exchange-schema";

export async function POST(request: Request) {
  const parsed = AuthExchangeSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const body = parsed.data;

    if (body.kind === "code") {
      const { error } = await supabase.auth.exchangeCodeForSession(body.code);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    if (body.kind === "otp") {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: body.tokenHash,
        type: body.type,
      });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    const { error } = await supabase.auth.setSession({
      access_token: body.accessToken,
      refresh_token: body.refreshToken,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/auth/exchange]", err);
    return NextResponse.json(
      { error: "Não foi possível validar o link de autenticação." },
      { status: 500 },
    );
  }
}
