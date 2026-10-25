import webpush from "web-push";
import { prisma } from "@/lib/prisma";
import {
  buildPushPayloadJson,
  getVapidPrivateKey,
  getVapidPublicKey,
  getVapidSubject,
  isWebPushConfigured,
  type PushPayload,
} from "@/lib/web-push/config";

let configured = false;

function ensureWebPushConfigured(): boolean {
  if (configured) return true;
  const publicKey = getVapidPublicKey();
  const privateKey = getVapidPrivateKey();
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(getVapidSubject(), publicKey, privateKey);
  configured = true;
  return true;
}

export type SendPushResult = {
  sent: number;
  failed: number;
  removed: number;
};

export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<SendPushResult> {
  if (!ensureWebPushConfigured()) {
    return { sent: 0, failed: 0, removed: 0 };
  }

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId },
  });

  if (subscriptions.length === 0) {
    return { sent: 0, failed: 0, removed: 0 };
  }

  const body = buildPushPayloadJson(payload);
  let sent = 0;
  let failed = 0;
  let removed = 0;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
          { TTL: 60 * 60 * 24 },
        );
        sent += 1;
      } catch (err: unknown) {
        failed += 1;
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
          removed += 1;
        }
      }
    }),
  );

  return { sent, failed, removed };
}

export async function sendPushIfNotDelivered(input: {
  userId: string;
  dedupeKey: string;
  kind: string;
  payload: PushPayload;
}): Promise<boolean> {
  if (!isWebPushConfigured()) return false;

  try {
    await prisma.pushNotificationDelivery.create({
      data: {
        userId: input.userId,
        dedupeKey: input.dedupeKey,
        kind: input.kind,
      },
    });
  } catch {
    return false;
  }

  const result = await sendPushToUser(input.userId, input.payload);
  if (result.sent === 0) {
    await prisma.pushNotificationDelivery
      .delete({
        where: {
          userId_dedupeKey: { userId: input.userId, dedupeKey: input.dedupeKey },
        },
      })
      .catch(() => undefined);
    return false;
  }

  return true;
}

export { isWebPushConfigured };
