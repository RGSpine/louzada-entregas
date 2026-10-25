import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import {
  ACCESS_SESSION_COOKIE,
  accessLimitExceededMessage,
  clientIpFromHeaders,
  registerAccessSession,
  releaseAccessSession,
  touchAccessSession,
  type AccessPlatform,
} from "@/lib/access-session";
import { enforceRateLimit } from "@/lib/rate-limit";
import { extractBearerToken } from "@/lib/auth/request-auth";

const RegisterSchema = z.object({
  deviceId: z.string().trim().min(8).max(128),
  platform: z.enum(["web", "mobile", "desktop"]).optional(),
  claim: z.boolean().optional(),
});

const ACCESS_SESSION_RATE_LIMIT = { maxRequests: 30, windowSeconds: 600 };

async function resolveDbUserId(request: NextRequest): Promise<string | null> {
  const bearer = extractBearerToken(request);
  if (bearer) {
    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!url || !anonKey) return null;
    const supabase = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.getUser(bearer);
    if (error || !data.user?.id) return null;
    const dbUser = await prisma.user.findFirst({
      where: {
        OR: [{ authUserId: data.user.id }, { email: data.user.email ?? "" }],
      },
      select: { id: true },
    });
    return dbUser?.id ?? null;
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
    error,
  } = await supabase.auth.getUser();
  if (error || !authUser?.id) return null;

  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [{ authUserId: authUser.id }, { email: authUser.email ?? "" }],
    },
    select: { id: true },
  });
  return dbUser?.id ?? null;
}

function deviceIdFromRequest(request: NextRequest, bodyDeviceId?: string): string {
  const fromBody = bodyDeviceId?.trim();
  if (fromBody) return fromBody;
  return request.cookies.get(ACCESS_SESSION_COOKIE)?.value?.trim() ?? "";
}

function withDeviceCookie(response: NextResponse, deviceId: string): NextResponse {
  response.cookies.set(ACCESS_SESSION_COOKIE, deviceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}

export async function POST(request: NextRequest) {
  const userId = await resolveDbUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const rl = await enforceRateLimit(`access-session:${userId}`, ACCESS_SESSION_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Muitas tentativas. Aguarde ${rl.resetIn}s.` },
      { status: 429 },
    );
  }

  const parsed = RegisterSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  const userAgent = request.headers.get("user-agent");
  const result = await registerAccessSession({
    userId,
    deviceId: parsed.data.deviceId,
    userAgent,
    platform: parsed.data.platform as AccessPlatform | undefined,
    claimSlot: parsed.data.claim === true,
    ipAddress: clientIpFromHeaders(request.headers),
  });

  if (!result.ok) {
    if (result.reason === "checkout_required") {
      return NextResponse.json(
        {
          error: "Conclua a escolha do plano e o pagamento para acessar o sistema.",
          errorCode: "CHECKOUT_REQUIRED",
          redirectTo: "/dashboard",
        },
        { status: 402 },
      );
    }
    if (result.reason === "limit_exceeded") {
      return NextResponse.json(
        {
          error: accessLimitExceededMessage(result.maxSessions ?? 1),
          errorCode: "ACCESS_LIMIT_EXCEEDED",
          maxSessions: result.maxSessions,
          activeSessions: result.activeSessions,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Dispositivo inválido." }, { status: 400 });
  }

  return withDeviceCookie(
    NextResponse.json({
      ok: true,
      sessionId: result.sessionId,
      maxSessions: result.maxSessions,
      activeSessions: result.activeSessions,
    }),
    parsed.data.deviceId,
  );
}

export async function PATCH(request: NextRequest) {
  const userId = await resolveDbUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const deviceId = deviceIdFromRequest(request, typeof body?.deviceId === "string" ? body.deviceId : undefined);
  if (!deviceId) {
    return NextResponse.json({ error: "Dispositivo não identificado." }, { status: 400 });
  }

  const alive = await touchAccessSession({ userId, deviceId });
  if (!alive) {
    // Heartbeat não reassume o slot: outro aparelho (último login) ficou com a conta.
    return NextResponse.json(
      {
        error:
          "Sua sessão foi encerrada porque outro dispositivo assumiu o acesso desta conta.",
        errorCode: "ACCESS_LIMIT_EXCEEDED",
      },
      { status: 409 },
    );
  }

  return withDeviceCookie(NextResponse.json({ ok: true }), deviceId);
}

export async function DELETE(request: NextRequest) {
  const userId = await resolveDbUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const deviceId = deviceIdFromRequest(request, typeof body?.deviceId === "string" ? body.deviceId : undefined);
  if (deviceId) {
    await releaseAccessSession({ userId, deviceId });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ACCESS_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
