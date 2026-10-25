import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit } from "@/lib/rate-limit";
import { dispatchUserPushBackfill } from "@/lib/push-notifications/dispatch";
import { isWebPushConfigured } from "@/lib/web-push/send";

const SubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(10).max(512),
    auth: z.string().min(10).max(512),
  }),
});

const UnsubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
});

const PUSH_RATE_LIMIT = { maxRequests: 20, windowSeconds: 600 };

async function resolveDbUserId(): Promise<string | null> {
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

export async function POST(request: NextRequest) {
  const userId = await resolveDbUserId();
  if (!userId) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const rl = await enforceRateLimit(`push-subscribe:${userId}`, PUSH_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json({ error: `Aguarde ${rl.resetIn}s.` }, { status: 429 });
  }

  const parsed = SubscribeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  const userAgent = request.headers.get("user-agent");
  await prisma.pushSubscription.upsert({
    where: { endpoint: parsed.data.endpoint },
    create: {
      userId,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      userAgent,
    },
    update: {
      userId,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      userAgent,
    },
  });

  if (isWebPushConfigured()) {
    void dispatchUserPushBackfill(userId).catch(() => undefined);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const userId = await resolveDbUserId();
  if (!userId) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const parsed = UnsubscribeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Endpoint inválido." }, { status: 400 });
  }

  await prisma.pushSubscription.deleteMany({
    where: { userId, endpoint: parsed.data.endpoint },
  });

  return NextResponse.json({ ok: true });
}
