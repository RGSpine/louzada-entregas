import "server-only";

import { prisma } from "@/lib/prisma";
import { ensureCrmProfile, syncCrmAccount } from "@/lib/crm/sync-account";
import { notifyAdminCrmCritical } from "@/lib/crm/notify-critical";

export const CRM_ALERT_PAYMENT_FAILED = "PAYMENT_FAILED";

/**
 * Falha de cobrança Stripe (invoice.payment_failed) → alerta CRM CRITICAL
 * para follow-up de churn involuntário.
 */
export async function markStripePaymentFailed(input: {
  userId: string;
  attemptCount?: number | null;
  amountDueCents?: number | null;
  stripeInvoiceId?: string | null;
  stripeEventId?: string;
}): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      name: true,
      email: true,
      plan: true,
      isInfluencer: true,
    },
  });
  if (!user || user.isInfluencer) return;

  const display = user.name?.trim() || user.email || "profissional";
  const attempts = input.attemptCount ?? 1;
  const amountLabel =
    typeof input.amountDueCents === "number"
      ? (input.amountDueCents / 100).toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL",
        })
      : null;

  const profile = await ensureCrmProfile(user.id);
  const existing = await prisma.crmAlert.findFirst({
    where: {
      profileId: profile.id,
      alertType: CRM_ALERT_PAYMENT_FAILED,
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
    },
  });

  const title = "Falha de pagamento Stripe";
  const message = [
    `${display} teve falha de cobrança`,
    amountLabel ? `(${amountLabel})` : null,
    `— tentativa ${attempts}.`,
    "Risco de churn involuntário; envie link de atualização de cartão.",
  ]
    .filter(Boolean)
    .join(" ");

  const suggestedMessage = `Oi, ${display}! Notamos uma falha no pagamento da sua assinatura do Louzada Entregas. Pode ser cartão vencido ou limite. Quer que eu te envie o link seguro para atualizar o pagamento?`;

  if (!existing) {
    const created = await prisma.crmAlert.create({
      data: {
        profileId: profile.id,
        userId: user.id,
        alertType: CRM_ALERT_PAYMENT_FAILED,
        severity: attempts >= 2 ? "CRITICAL" : "HIGH",
        title,
        message,
        suggestedChannel: "WHATSAPP",
        suggestedMessage,
        metadata: {
          attemptCount: attempts,
          amountDueCents: input.amountDueCents ?? null,
          stripeInvoiceId: input.stripeInvoiceId ?? null,
          stripeEventId: input.stripeEventId ?? null,
        },
      },
    });

    if (created.severity === "CRITICAL" || attempts >= 2) {
      void notifyAdminCrmCritical({
        alertId: created.id,
        userId: user.id,
        alertType: CRM_ALERT_PAYMENT_FAILED,
        title,
        message,
        userName: user.name,
        userEmail: user.email,
        suggestedMessage,
      }).catch((err) =>
        console.error("[crm] notify after payment failed:", err),
      );
    }
  } else {
    await prisma.crmAlert.update({
      where: { id: existing.id },
      data: {
        severity: attempts >= 2 ? "CRITICAL" : existing.severity,
        message,
        metadata: {
          attemptCount: attempts,
          amountDueCents: input.amountDueCents ?? null,
          stripeInvoiceId: input.stripeInvoiceId ?? null,
          stripeEventId: input.stripeEventId ?? null,
        },
      },
    });
  }

  void syncCrmAccount(user.id).catch((err) =>
    console.error("[crm] sync after payment failed:", user.id, err),
  );
}

/** Pagamento recuperado (invoice.paid) — fecha alerta de falha. */
export async function clearStripePaymentFailed(userId: string): Promise<void> {
  await prisma.crmAlert.updateMany({
    where: {
      userId,
      alertType: CRM_ALERT_PAYMENT_FAILED,
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
    },
    data: { status: "RESOLVED", resolvedAt: new Date() },
  });
  void syncCrmAccount(userId).catch(() => undefined);
}
