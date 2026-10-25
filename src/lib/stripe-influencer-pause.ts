import Stripe from "stripe";

/**
 * Status em que a Stripe ainda pode emitir a próxima fatura.
 * `pause_collection` não reembolsa o período já pago — só impede cobranças futuras.
 */
const PAUSABLE_STATUSES: Stripe.Subscription.Status[] = [
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
  "incomplete",
];

export function subscriptionCollectsPayment(
  subscription: Pick<Stripe.Subscription, "status" | "pause_collection">,
): boolean {
  if (!PAUSABLE_STATUSES.includes(subscription.status)) return false;
  return subscription.pause_collection == null;
}

/**
 * Pausa a cobrança (não cancela a assinatura).
 * Faturas já pagas do período vigente permanecem; as próximas são anuladas (`void`)
 * enquanto o profissional for influencer.
 */
export async function pauseStripeBillingForInfluencer(input: {
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}): Promise<{ ok: boolean; pausedIds: string[]; error?: string }> {
  const customerId = input.stripeCustomerId?.trim() || null;
  const subscriptionId = input.stripeSubscriptionId?.trim() || null;
  if (!customerId && !subscriptionId) {
    return { ok: true, pausedIds: [] };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    return { ok: false, pausedIds: [], error: "Stripe não configurado." };
  }

  const stripe = new Stripe(secretKey);
  const byId = new Map<string, Stripe.Subscription>();

  if (subscriptionId) {
    try {
      byId.set(subscriptionId, await stripe.subscriptions.retrieve(subscriptionId));
    } catch (err) {
      console.error("[influencer-pause] retrieve subscription:", err);
    }
  }

  if (customerId) {
    try {
      const listed = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 20,
      });
      for (const sub of listed.data) byId.set(sub.id, sub);
    } catch (err) {
      console.error("[influencer-pause] list subscriptions:", err);
    }
  }

  const pausedIds: string[] = [];
  for (const sub of byId.values()) {
    if (!subscriptionCollectsPayment(sub)) continue;
    try {
      await stripe.subscriptions.update(sub.id, {
        pause_collection: { behavior: "void" },
      });
      pausedIds.push(sub.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha ao pausar assinatura.";
      console.error("[influencer-pause] update:", sub.id, err);
      return { ok: false, pausedIds, error: message };
    }
  }

  return { ok: true, pausedIds };
}

/** Retoma a cobrança quando a parceria de influencer é removida. */
export async function resumeStripeBillingAfterInfluencer(input: {
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}): Promise<{ ok: boolean; resumedIds: string[]; error?: string }> {
  const customerId = input.stripeCustomerId?.trim() || null;
  const subscriptionId = input.stripeSubscriptionId?.trim() || null;
  if (!customerId && !subscriptionId) {
    return { ok: true, resumedIds: [] };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    return { ok: false, resumedIds: [], error: "Stripe não configurado." };
  }

  const stripe = new Stripe(secretKey);
  const byId = new Map<string, Stripe.Subscription>();

  if (subscriptionId) {
    try {
      byId.set(subscriptionId, await stripe.subscriptions.retrieve(subscriptionId));
    } catch {
      /* assinatura já removida */
    }
  }
  if (customerId) {
    try {
      const listed = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 20,
      });
      for (const sub of listed.data) byId.set(sub.id, sub);
    } catch (err) {
      console.error("[influencer-pause] list on resume:", err);
    }
  }

  const resumedIds: string[] = [];
  for (const sub of byId.values()) {
    if (sub.status === "canceled" || sub.status === "incomplete_expired") continue;
    if (sub.pause_collection == null) continue;
    try {
      await stripe.subscriptions.update(sub.id, {
        pause_collection: "",
      });
      resumedIds.push(sub.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha ao retomar assinatura.";
      return { ok: false, resumedIds, error: message };
    }
  }

  return { ok: true, resumedIds };
}
