import "server-only";

import { prisma } from "@/lib/prisma";
import { ensureCrmProfile, syncCrmAccount } from "@/lib/crm/sync-account";
import { scheduleCrmPlanChange } from "@/lib/crm/touch";

export const CRM_ALERT_CANCEL_SCHEDULED = "CANCEL_SCHEDULED";

/**
 * Marca cancelamento agendado (Stripe cancel_at_period_end) e cria alerta CRM
 * para o administrador (robertoguanaes@gmail.com) fazer follow-up.
 */
export async function markStripeCancelScheduled(input: {
  userId: string;
  fromPlan: string;
  currentPeriodEnd?: Date | null;
  source?: string;
  stripeEventId?: string;
  reasonNote?: string;
}): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      name: true,
      email: true,
      plan: true,
      stripeCancelAtPeriodEnd: true,
      currentPeriodEnd: true,
      isInfluencer: true,
    },
  });
  if (!user || user.isInfluencer) return;

  const periodEnd = input.currentPeriodEnd ?? user.currentPeriodEnd;
  const endLabel = periodEnd
    ? periodEnd.toLocaleDateString("pt-BR")
    : "o fim do período já pago";
  const display = user.name?.trim() || user.email || "profissional";

  await prisma.user.update({
    where: { id: user.id },
    data: {
      stripeCancelAtPeriodEnd: true,
      ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}),
    },
  });

  // Evita duplicar evento se o webhook e a action disparam próximos.
  if (!user.stripeCancelAtPeriodEnd) {
    scheduleCrmPlanChange({
      userId: user.id,
      fromPlan: input.fromPlan || user.plan || "NONE",
      toPlan: input.fromPlan || user.plan || "NONE",
      reason: "CANCEL_SCHEDULED",
      reasonNote:
        input.reasonNote ??
        `Cancelamento agendado na Stripe. Acesso até ${endLabel}.`,
      source: input.source ?? "STRIPE",
      stripeEventId: input.stripeEventId,
    });
  }

  const profile = await ensureCrmProfile(user.id);
  const existing = await prisma.crmAlert.findFirst({
    where: {
      profileId: profile.id,
      alertType: CRM_ALERT_CANCEL_SCHEDULED,
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
    },
  });

  if (!existing) {
    const title = "Cancelamento de plano agendado";
    const message = `${display} pediu cancelamento. Mantém acesso até ${endLabel}. Faça follow-up de retenção.`;
    const suggestedMessage = `Oi, ${display}! Vi que você solicitou o cancelamento do Louzada Entregas. Antes de encerrar, posso entender o que faltou pra você e ver se há como ajustar?`;

    const created = await prisma.crmAlert.create({
      data: {
        profileId: profile.id,
        userId: user.id,
        alertType: CRM_ALERT_CANCEL_SCHEDULED,
        severity: "CRITICAL",
        title,
        message,
        suggestedChannel: "WHATSAPP",
        suggestedMessage,
        metadata: {
          currentPeriodEnd: periodEnd?.toISOString() ?? null,
          plan: user.plan,
        },
      },
    });

    const { notifyAdminCrmCritical } = await import("@/lib/crm/notify-critical");
    void notifyAdminCrmCritical({
      alertId: created.id,
      userId: user.id,
      alertType: CRM_ALERT_CANCEL_SCHEDULED,
      title,
      message,
      userName: user.name,
      userEmail: user.email,
      suggestedMessage,
    }).catch((err) =>
      console.error("[crm] notify critical after cancel scheduled:", err),
    );
  }

  void syncCrmAccount(user.id).catch((err) =>
    console.error("[crm] sync after cancel scheduled:", user.id, err),
  );
}

/**
 * Reconcilia cancel_at_period_end da Stripe → flag + alerta CRM.
 * Usado no "Sincronizar dados" do admin para pegar cancelamentos já feitos
 * no Dashboard Stripe (ex.: 26/09) sem depender só do webhook ao vivo.
 */
export async function syncCancelScheduledFromStripe(): Promise<number> {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) return 0;

  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(secretKey);

  const users = await prisma.user.findMany({
    where: {
      stripeSubscriptionId: { not: null },
      isInfluencer: false,
    },
    select: {
      id: true,
      plan: true,
      stripeSubscriptionId: true,
      stripeCancelAtPeriodEnd: true,
    },
  });

  let touched = 0;
  for (const user of users) {
    const subId = user.stripeSubscriptionId;
    if (!subId) continue;
    try {
      const sub = await stripe.subscriptions.retrieve(subId);
      const active = sub.status === "active" || sub.status === "trialing";
      const cancelAtPeriodEnd = Boolean(sub.cancel_at_period_end) && active;
      const periodEndUnix =
        (sub as { current_period_end?: number }).current_period_end ??
        sub.items?.data?.[0]?.current_period_end;
      const periodEnd =
        typeof periodEndUnix === "number"
          ? new Date(periodEndUnix * 1000)
          : null;

      if (cancelAtPeriodEnd) {
        await markStripeCancelScheduled({
          userId: user.id,
          fromPlan: user.plan ?? "NONE",
          currentPeriodEnd: periodEnd,
          source: "STRIPE_SYNC",
        });
        touched += 1;
      } else if (user.stripeCancelAtPeriodEnd) {
        await clearStripeCancelScheduled(user.id);
        touched += 1;
      }
    } catch (err) {
      console.error("[crm] syncCancelScheduledFromStripe:", user.id, err);
    }
  }
  return touched;
}

/** Usuário reativou a assinatura (cancel_at_period_end voltou a false). */
export async function clearStripeCancelScheduled(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, stripeCancelAtPeriodEnd: true },
  });
  if (!user?.stripeCancelAtPeriodEnd) return;

  await prisma.user.update({
    where: { id: userId },
    data: { stripeCancelAtPeriodEnd: false },
  });

  await prisma.crmAlert.updateMany({
    where: {
      userId,
      alertType: CRM_ALERT_CANCEL_SCHEDULED,
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
    },
    data: { status: "RESOLVED", resolvedAt: new Date() },
  });

  void syncCrmAccount(userId).catch(() => undefined);
}
