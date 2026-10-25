import { prisma } from "@/lib/prisma";
import { isPlatformOwnerEmail } from "@/lib/plan-limits";
import { isIncompletePlan, normalizePlanTier } from "@/lib/plan-tier";

export const ACCESS_SESSION_COOKIE = "louzada_device_id";

/**
 * Janela de concorrência real (tempo real).
 * Heartbeat a cada ~2 min; sem ping recente o slot é liberado.
 * NÃO usar TTL de semanas — isso acumulava sessões fantasma (local/incógnito/abas).
 */
export const ACCESS_SESSION_CONCURRENT_MS = 10 * 60 * 1000;

/** Heartbeat do cliente. A constante vive fora deste arquivo para o navegador não carregar o Prisma. */
export { ACCESS_SESSION_HEARTBEAT_MS } from "@/lib/access-session-timing";

/**
 * Registro do deviceId no banco pode permanecer por mais tempo (mesmo aparelho).
 * Só a contagem de slots usa ACCESS_SESSION_CONCURRENT_MS.
 */
export const ACCESS_SESSION_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** @deprecated use ACCESS_SESSION_CONCURRENT_MS — mantido para imports legados de testes. */
export const ACCESS_SESSION_TTL_MS = ACCESS_SESSION_CONCURRENT_MS;

export type AccessPlatform = "web" | "mobile" | "desktop";

export type AccessSessionRegisterResult =
  | { ok: true; sessionId: string; maxSessions: number; activeSessions: number }
  | {
      ok: false;
      reason: "limit_exceeded" | "checkout_required" | "invalid_device" | "user_not_found";
      maxSessions?: number;
      activeSessions?: number;
    };

export type AccessSessionPublic = {
  id: string;
  platform: string;
  deviceLabel: string | null;
  ipAddress: string | null;
  lastSeenAt: string;
  isCurrent: boolean;
};

/** IP do cliente (Vercel/proxy). Só o primeiro hop; truncado. */
export function clientIpFromHeaders(headers: {
  get(name: string): string | null;
}): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  return null;
}

function concurrentCutoff(): Date {
  return new Date(Date.now() - ACCESS_SESSION_CONCURRENT_MS);
}

function deviceRegistrationCutoff(): Date {
  return new Date(Date.now() - ACCESS_SESSION_DEVICE_TTL_MS);
}

/**
 * Limites de acesso simultâneo por plano comercial.
 * CONSULTORIO = 5 · CLINICA = 10 · individuais (BASICO/PROFISSIONAL/PREMIUM) = 1
 * Influencer no plano individual também = 1 (parceria não fura o teto de aparelhos).
 * Plano incompleto não bloqueia o cadastro: esta aplicação não exige plano Stripe.
 * Dono da plataforma: sem teto.
 */
export function getMaxConcurrentSessionsForPlan(
  plan: string | null | undefined,
  email?: string | null,
  _isInfluencer?: boolean,
): number {
  if (isPlatformOwnerEmail(email)) return Number.POSITIVE_INFINITY;
  if (isIncompletePlan(plan)) {
    return Number.POSITIVE_INFINITY;
  }
  const tier = normalizePlanTier(plan);
  if (!tier) return Number.POSITIVE_INFINITY;
  if (tier === "CONSULTORIO") return 5;
  if (tier === "CLINICA") return 10;
  return 1;
}

/** Plano individual: um aparelho; o último claim/login desconecta os demais. */
export function isLastLoginWinsSessionPlan(maxSessions: number): boolean {
  return maxSessions === 1;
}

export type AccessSessionRecency = {
  id: string;
  lastSeenAt: Date;
  createdAt: Date;
};

/** Um único vencedor mesmo com `lastSeenAt` idêntico (mesmo ms). */
export const ACCESS_SESSION_RECENCY_ORDER = [
  { lastSeenAt: "desc" as const },
  { createdAt: "desc" as const },
  { id: "desc" as const },
];

/** Negativo = `a` é mais recente (vence). Empate de relógio: createdAt, depois id. */
export function compareAccessSessionRecency(
  a: AccessSessionRecency,
  b: AccessSessionRecency,
): number {
  const seen = b.lastSeenAt.getTime() - a.lastSeenAt.getTime();
  if (seen !== 0) return seen;
  const created = b.createdAt.getTime() - a.createdAt.getTime();
  if (created !== 0) return created;
  if (b.id > a.id) return 1;
  if (b.id < a.id) return -1;
  return 0;
}

export function isWinningAccessSession(
  self: AccessSessionRecency,
  others: AccessSessionRecency[],
): boolean {
  return others.every((other) => compareAccessSessionRecency(self, other) < 0);
}

export function accessLimitExceededMessage(maxSessions: number): string {
  if (maxSessions === 1) {
    return "Esta conta já está em uso no número máximo de aparelhos (1 acesso simultâneo do seu plano). Encerre a sessão em outro dispositivo e tente novamente.";
  }
  if (maxSessions === 5) {
    return "Esta conta já está em uso no número máximo de aparelhos (5 acessos do plano Consultório). Encerre a sessão em outro dispositivo e tente novamente.";
  }
  if (maxSessions === 10) {
    return "Esta conta já está em uso no número máximo de aparelhos (10 acessos do plano Clínica). Encerre a sessão em outro dispositivo e tente novamente.";
  }
  return `Esta conta já está em uso no número máximo de aparelhos (${maxSessions} acessos simultâneos). Encerre a sessão em outro dispositivo e tente novamente.`;
}

/**
 * Modelo de telas simultâneas:
 * - Individuais (Básico/Profissional/Premium, Stripe ou influencer): 1 aparelho.
 *   Último login/claim vence — o outro dispositivo é desconectado.
 * - Consultório=5, Clínica=10: teto rígido estilo Netflix (não expulsa quem já está).
 * - Contagem em tempo real: só dispositivos com heartbeat recente.
 * - Heartbeat NÃO reassume o slot depois de ser desconectado.
 */

export function detectAccessPlatform(userAgent: string | null | undefined): AccessPlatform {
  const ua = (userAgent ?? "").toLowerCase();
  if (/aievolui|expo|react-native|okhttp|dart\/|cfnetwork\//.test(ua)) return "mobile";
  if (/electron|tauri|desktop/.test(ua)) return "desktop";
  if (/mobile|android|iphone|ipad|ipod/.test(ua)) return "mobile";
  return "web";
}

export function buildDeviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  if (/iphone/i.test(ua)) return "iPhone";
  if (/ipad/i.test(ua)) return "iPad";
  if (/android/i.test(ua)) return "Android";
  if (/mac os x/i.test(ua)) return "Mac";
  if (/windows/i.test(ua)) return "Windows";
  if (/linux/i.test(ua)) return "Linux";
  return "Navegador";
}

/** Conta só dispositivos com heartbeat recente (tempo real). */
async function countActiveSessions(userId: string): Promise<number> {
  const cutoff = concurrentCutoff();
  return prisma.userAccessSession.count({
    where: { userId, lastSeenAt: { gte: cutoff } },
  });
}

/** Remove registros muito antigos (limpeza) e libera slots sem heartbeat. */
async function pruneStaleSessions(userId: string): Promise<void> {
  const deviceCutoff = deviceRegistrationCutoff();
  await prisma.userAccessSession.deleteMany({
    where: { userId, lastSeenAt: { lt: deviceCutoff } },
  });
}

/**
 * Garante no máximo `maxSessions` com heartbeat recente, preservando `keepSessionId`.
 */
async function enforceSessionCap(
  userId: string,
  keepSessionId: string,
  maxSessions: number,
): Promise<number> {
  if (!Number.isFinite(maxSessions)) {
    return countActiveSessions(userId);
  }

  const cutoff = concurrentCutoff();
  const sessions = await prisma.userAccessSession.findMany({
    where: { userId, lastSeenAt: { gte: cutoff } },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true },
  });

  if (sessions.length <= maxSessions) return sessions.length;

  const keep = new Set<string>([keepSessionId]);
  for (const session of sessions) {
    if (keep.size >= maxSessions) break;
    keep.add(session.id);
  }

  const dropIds = sessions.filter((s) => !keep.has(s.id)).map((s) => s.id);
  if (dropIds.length > 0) {
    await prisma.userAccessSession.deleteMany({ where: { id: { in: dropIds } } });
  }
  return keep.size;
}

/**
 * No login (claim) de plano individual (max=1): desconecta os demais.
 * Em Consultório/Clínica NÃO há reclaim — o 4º dispositivo permanece bloqueado
 * enquanto houver `maxSessions` com heartbeat recente (tempo real).
 */
async function reclaimForIndividualClaim(userId: string): Promise<void> {
  await prisma.userAccessSession.deleteMany({ where: { userId } });
}

export async function registerAccessSession(input: {
  userId: string;
  deviceId: string;
  userAgent?: string | null;
  platform?: AccessPlatform;
  /** No login: planos individuais (1) assumem o único slot; equipe respeita o teto. */
  claimSlot?: boolean;
  ipAddress?: string | null;
}): Promise<AccessSessionRegisterResult> {
  const deviceId = input.deviceId.trim();
  if (!deviceId || deviceId.length > 128) {
    return { ok: false, reason: "invalid_device" };
  }

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      plan: true,
      email: true,
      isInfluencer: true,
      stripeSubscriptionId: true,
      basicoCheckoutRequired: true,
    },
  });
  if (!user) return { ok: false, reason: "user_not_found" };

  await pruneStaleSessions(user.id);

  const maxSessions = getMaxConcurrentSessionsForPlan(user.plan, user.email, user.isInfluencer);
  const platform = input.platform ?? detectAccessPlatform(input.userAgent);
  const deviceLabel = buildDeviceLabel(input.userAgent);

  const existing = await prisma.userAccessSession.findUnique({
    where: { userId_deviceId: { userId: user.id, deviceId } },
  });

  const cutoff = concurrentCutoff();

  if (existing) {
    const alreadyStreaming = existing.lastSeenAt >= cutoff;

    // Netflix: aparelho ocioso que tenta “voltar a transmitir” conta como nova tela.
    // Se as N telas do plano já estão ativas, bloqueia — não derruba ninguém.
    if (!alreadyStreaming && Number.isFinite(maxSessions)) {
      const activeSessions = await countActiveSessions(user.id);
      if (activeSessions >= maxSessions) {
        if (input.claimSlot && isLastLoginWinsSessionPlan(maxSessions)) {
          await reclaimForIndividualClaim(user.id);
        } else {
          return { ok: false, reason: "limit_exceeded", maxSessions, activeSessions };
        }
      }
    }

    const updated = await prisma.userAccessSession.update({
      where: { id: existing.id },
      data: {
        lastSeenAt: new Date(),
        platform,
        deviceLabel,
        ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
      },
    });

    if (input.claimSlot && isLastLoginWinsSessionPlan(maxSessions)) {
      await prisma.userAccessSession.deleteMany({
        where: { userId: user.id, id: { not: updated.id } },
      });
    } else if (alreadyStreaming) {
      // Já estava na contagem: só saneia overflow residual sem priorizar este device
      // além do que já tinha (mantém teto).
      await enforceSessionCap(user.id, updated.id, maxSessions);
    }

    const activeSessions = await countActiveSessions(user.id);
    return { ok: true, sessionId: updated.id, maxSessions, activeSessions };
  }

  const activeSessions = await countActiveSessions(user.id);
  if (Number.isFinite(maxSessions) && activeSessions >= maxSessions) {
    if (input.claimSlot && isLastLoginWinsSessionPlan(maxSessions)) {
      // Individual (1 tela): novo login assume a única transmissão.
      await reclaimForIndividualClaim(user.id);
    } else {
      // 4ª tela (Consultório) / 7ª (Clínica): bloqueio rígido estilo Netflix.
      return { ok: false, reason: "limit_exceeded", maxSessions, activeSessions };
    }
  }

  const created = await prisma.userAccessSession.create({
    data: {
      userId: user.id,
      deviceId,
      platform,
      deviceLabel,
      ipAddress: input.ipAddress ?? null,
      lastSeenAt: new Date(),
    },
  });

  const capped = await enforceSessionCap(user.id, created.id, maxSessions);

  return {
    ok: true,
    sessionId: created.id,
    maxSessions,
    activeSessions: capped,
  };
}

export async function touchAccessSession(input: {
  userId: string;
  deviceId: string;
}): Promise<boolean> {
  const deviceId = input.deviceId.trim();
  if (!deviceId) return false;

  await pruneStaleSessions(input.userId);

  const existing = await prisma.userAccessSession.findUnique({
    where: { userId_deviceId: { userId: input.userId, deviceId } },
  });
  if (!existing) return false;

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { plan: true, email: true, isInfluencer: true },
  });
  if (!user) return false;

  const maxSessions = getMaxConcurrentSessionsForPlan(
    user.plan,
    user.email,
    user.isInfluencer,
  );

  const cutoff = concurrentCutoff();
  const alreadyStreaming = existing.lastSeenAt >= cutoff;
  if (!alreadyStreaming && Number.isFinite(maxSessions)) {
    const active = await countActiveSessions(input.userId);
    if (active >= maxSessions) {
      // Heartbeat de aparelho ocioso não pode “roubar” tela de quem está ativo.
      return false;
    }
  }

  await prisma.userAccessSession.update({
    where: { id: existing.id },
    data: { lastSeenAt: new Date() },
  });
  if (alreadyStreaming) {
    await enforceSessionCap(input.userId, existing.id, maxSessions);
  }
  return true;
}

export async function releaseAccessSession(input: {
  userId: string;
  deviceId: string;
}): Promise<void> {
  const deviceId = input.deviceId.trim();
  if (!deviceId) return;
  await prisma.userAccessSession.deleteMany({
    where: { userId: input.userId, deviceId },
  });
}

/**
 * Lista sessões com heartbeat recente (contador em tempo real) + metadados do plano.
 */
export async function listConcurrentAccessSessions(input: {
  userId: string;
  currentDeviceId?: string | null;
}): Promise<{
  maxSessions: number;
  activeSessions: number;
  sessions: AccessSessionPublic[];
}> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { plan: true, email: true, isInfluencer: true },
  });
  if (!user) {
    return { maxSessions: 0, activeSessions: 0, sessions: [] };
  }

  await pruneStaleSessions(input.userId);

  const maxSessions = getMaxConcurrentSessionsForPlan(
    user.plan,
    user.email,
    user.isInfluencer,
  );
  const cutoff = concurrentCutoff();
  const rows = await prisma.userAccessSession.findMany({
    where: { userId: input.userId, lastSeenAt: { gte: cutoff } },
    orderBy: { lastSeenAt: "desc" },
    select: {
      id: true,
      deviceId: true,
      platform: true,
      deviceLabel: true,
      ipAddress: true,
      lastSeenAt: true,
    },
  });

  const current = input.currentDeviceId?.trim() ?? "";
  return {
    maxSessions: Number.isFinite(maxSessions) ? maxSessions : rows.length,
    activeSessions: rows.length,
    sessions: rows.map((r) => ({
      id: r.id,
      platform: r.platform,
      deviceLabel: r.deviceLabel,
      ipAddress: r.ipAddress,
      lastSeenAt: r.lastSeenAt.toISOString(),
      isCurrent: Boolean(current) && r.deviceId === current,
    })),
  };
}

export async function revokeAccessSessionById(input: {
  userId: string;
  sessionId: string;
}): Promise<boolean> {
  const result = await prisma.userAccessSession.deleteMany({
    where: { id: input.sessionId, userId: input.userId },
  });
  return result.count > 0;
}

export async function isAccessSessionActive(input: {
  userId: string;
  deviceId: string;
}): Promise<boolean> {
  const deviceId = input.deviceId.trim();
  if (!deviceId) return false;

  const session = await prisma.userAccessSession.findUnique({
    where: { userId_deviceId: { userId: input.userId, deviceId } },
    select: { id: true, lastSeenAt: true },
  });
  if (!session) return false;

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { plan: true, email: true, isInfluencer: true },
  });
  if (!user) return false;

  const maxSessions = getMaxConcurrentSessionsForPlan(
    user.plan,
    user.email,
    user.isInfluencer,
  );

  // Individual: só o aparelho mais recente. Empate no mesmo ms → createdAt, depois id.
  if (isLastLoginWinsSessionPlan(maxSessions)) {
    const winner = await prisma.userAccessSession.findFirst({
      where: { userId: input.userId },
      orderBy: ACCESS_SESSION_RECENCY_ORDER,
      select: { id: true },
    });
    return winner?.id === session.id;
  }

  const cutoff = deviceRegistrationCutoff();
  return session.lastSeenAt >= cutoff;
}
