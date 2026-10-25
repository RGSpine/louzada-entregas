"use server";

import { z } from "zod";
import { getAuthenticatedDbUserId } from "@/lib/patient-ownership";
import {
  buildDashboardNotificationsFeed,
  markDashboardNotificationsRead,
  type DashboardNotificationsFeed,
} from "@/lib/dashboard-notifications";

export async function getDashboardNotifications(): Promise<
  DashboardNotificationsFeed | { error: string }
> {
  const userId = await getAuthenticatedDbUserId();
  if (!userId) {
    return { error: "Não autenticado." };
  }

  try {
    return await buildDashboardNotificationsFeed(userId);
  } catch (e) {
    console.error("[getDashboardNotifications]", e);
    return { error: "Não foi possível carregar as notificações." };
  }
}

const markReadSchema = z.object({
  ids: z.array(z.string().min(1).max(120)).max(50),
});

export async function markDashboardNotificationsAsRead(
  input: z.infer<typeof markReadSchema>,
): Promise<{ success: true; cleared: number } | { success: false; error: string }> {
  const userId = await getAuthenticatedDbUserId();
  if (!userId) {
    return { success: false, error: "Não autenticado." };
  }

  const parsed = markReadSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Pedido inválido." };
  }

  try {
    const { saved } = await markDashboardNotificationsRead(userId, parsed.data.ids);
    return { success: true, cleared: parsed.data.ids.length || saved };
  } catch (e) {
    console.error("[markDashboardNotificationsAsRead]", e);
    return { success: false, error: "Não foi possível marcar como lidas." };
  }
}
