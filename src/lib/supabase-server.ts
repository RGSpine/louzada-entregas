import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { mergeAuthCookieOptions } from "@/lib/auth/cookie-options";

/**
 * Cria um cliente Supabase para uso em Server Components/Actions
 * Usa cookies para manter a sessão do usuário
 * NOTA: Esta função é async por causa do Next.js 15+ onde cookies() retorna Promise
 * IMPORTANTE: Usa getAll/setAll (padrão @supabase/ssr 0.5+) para suportar cookies chunked
 * Cookie options explícitas: Safari iOS exige Secure + SameSite=Lax + Path=/
 */
export async function createSupabaseServerClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      `Supabase não configurado. Variáveis faltando.\n` +
        `Adicione SUPABASE_URL e SUPABASE_ANON_KEY no .env`,
    );
  }

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookieOptions: mergeAuthCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, mergeAuthCookieOptions(options)),
          );
        } catch {
          // setAll pode falhar em Server Components (read-only).
        }
      },
    },
  });
}

/**
 * Cria um cliente Supabase ADMIN para operações privilegiadas
 * (criar/deletar usuários, etc.) - NÃO usa cookies
 */
/** Cliente anônimo sem cookies, para conferir a senha atual sem trocar a sessão. */
export function createSupabaseAnonClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      `Supabase não configurado. Variáveis faltando.\n` +
        `Adicione SUPABASE_URL e SUPABASE_ANON_KEY no .env`,
    );
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function createSupabaseAdminClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      `Supabase Admin não configurado.\n` +
        `Adicione SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env`,
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
