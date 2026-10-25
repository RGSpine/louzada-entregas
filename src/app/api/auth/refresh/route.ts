import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { mergeAuthCookieOptions } from "@/lib/auth/cookie-options";

type PendingCookie = {
  name: string;
  value: string;
  options?: CookieOptions;
};

/** Confirma a sessão via cookies httpOnly (sem segundo getUser no proxy). */
export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  const pendingCookies: PendingCookie[] = [];

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

  try {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookieOptions: mergeAuthCookieOptions(),
      cookies: {
        getAll() {
          return cookiesForSupabase();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            pendingCookies.push({ name, value, options });
          });
        },
      },
    });

    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const response = NextResponse.json({ ok: true });
    for (const c of pendingCookies) {
      response.cookies.set(c.name, c.value, mergeAuthCookieOptions(c.options));
    }
    return response;
  } catch (err) {
    console.error("[api/auth/refresh]", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
