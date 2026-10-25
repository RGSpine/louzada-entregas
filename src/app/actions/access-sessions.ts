"use server";

import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import {
  ACCESS_SESSION_COOKIE,
  listConcurrentAccessSessions,
  revokeAccessSessionById,
  type AccessSessionPublic,
} from "@/lib/access-session";

export type AccessSessionsSnapshot = {
  maxSessions: number;
  activeSessions: number;
  sessions: AccessSessionPublic[];
  /** Janela em minutos usada na contagem em tempo real. */
  concurrentWindowMinutes: number;
};

async function resolveTenantUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
    error,
  } = await supabase.auth.getUser();
  if (error || !authUser) return null;

  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [{ authUserId: authUser.id }, { email: authUser.email ?? "" }],
    },
    select: { id: true },
  });
  return dbUser?.id ?? null;
}

/** Contador em tempo real: só dispositivos com heartbeat recente. */
export async function getMyAccessSessions(): Promise<
  { success: true; data: AccessSessionsSnapshot } | { success: false; error: string }
> {
  const userId = await resolveTenantUserId();
  if (!userId) return { success: false, error: "Não autenticado." };

  const jar = await cookies();
  const currentDeviceId = jar.get(ACCESS_SESSION_COOKIE)?.value ?? null;
  const snapshot = await listConcurrentAccessSessions({
    userId,
    currentDeviceId,
  });

  return {
    success: true,
    data: {
      ...snapshot,
      concurrentWindowMinutes: 10,
    },
  };
}

/** Encerra um dispositivo ativo (libera o slot imediatamente). */
export async function revokeMyAccessSession(
  sessionId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const userId = await resolveTenantUserId();
  if (!userId) return { success: false, error: "Não autenticado." };
  if (!sessionId.trim()) return { success: false, error: "Sessão inválida." };

  const ok = await revokeAccessSessionById({ userId, sessionId: sessionId.trim() });
  if (!ok) return { success: false, error: "Sessão não encontrada." };
  return { success: true };
}
