import Stripe from "stripe";

export type StripeBillingCancelMode = "account_delete" | "subscription_cancel";

export type CancelStripeBillingInput = {
  stripeCustomerId: string | null | undefined;
  stripeSubscriptionId: string | null | undefined;
  mode: StripeBillingCancelMode;
  /** Só para logs. */
  userId?: string | null;
};

export type CancelStripeBillingResult = {
  ok: boolean;
  skipped: boolean;
  canceledSubscriptionIds: string[];
  scheduledCancelAtPeriodEndIds: string[];
  deletedCustomer: boolean;
  endedTrialImmediately: boolean;
  /**
   * Destino da assinatura em `User.stripeSubscriptionId`.
   * Em resultados mistos (leftovers cancelados + active agendado), use isto —
   * não `canceledSubscriptionIds.length > 0` — para atualizar o Prisma.
   */
  primaryOutcome: "canceled" | "scheduled" | "unchanged" | "missing" | "none";
  error?: string;
};

function getStripeClient(): Stripe | null {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) return null;
  return new Stripe(secretKey);
}

const OPEN_STATUSES: Stripe.Subscription.Status[] = [
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
  // Checkout iniciado / 1.ª fatura pendente — ainda pode tornar-se active e cobrar.
  "incomplete",
];

/** Assinaturas que ainda podem gerar cobrança ou completar o 1.º pagamento. */
export function isOpenBillingSubscriptionStatus(
  status: Stripe.Subscription.Status,
): boolean {
  return OPEN_STATUSES.includes(status);
}

/**
 * Decide se a assinatura deve ser encerrada já (sem esperar o fim do período).
 * Trial, incomplete e exclusão de conta: imediato — evita cobrança após "cancelar/deletar".
 */
export function shouldCancelSubscriptionImmediately(
  mode: StripeBillingCancelMode,
  status: Stripe.Subscription.Status,
): boolean {
  if (mode === "account_delete") return true;
  return (
    status === "trialing" ||
    status === "incomplete" ||
    status === "past_due" ||
    status === "unpaid" ||
    status === "paused"
  );
}

/**
 * Se o Prisma deve zerar plano/IDs Stripe após `cancelStripeBillingForUser`
 * em modo `subscription_cancel`.
 *
 * Nunca limpa se ainda houver assinatura com `cancel_at_period_end` (acesso pago
 * até o fim do período). Isso cobre primary já morto + leftover active agendado.
 */
export function shouldClearLocalPlanAfterCancel(
  primaryOutcome: CancelStripeBillingResult["primaryOutcome"],
  canceledCount: number,
  scheduledCount: number,
): boolean {
  if (scheduledCount > 0) return false;
  if (primaryOutcome === "canceled") return true;
  if (primaryOutcome === "scheduled") return false;
  return canceledCount > 0;
}

/**
 * Alinha `primaryOutcome` ao efeito real na cobrança do customer.
 * Leftovers sem `stripeSubscriptionId`, ou primary morto + active agendado,
 * não devem ficar como `none`/`canceled` se ainda há período pago a correr.
 */
export function resolveUserFacingPrimaryOutcome(
  _subscriptionId: string | null,
  primaryOutcome: CancelStripeBillingResult["primaryOutcome"],
  canceledCount: number,
  scheduledCount: number,
): CancelStripeBillingResult["primaryOutcome"] {
  if (scheduledCount > 0) return "scheduled";
  // Leftovers cancelados com primary id stale/ausente → cobrança encerrada.
  if (
    canceledCount > 0 &&
    (primaryOutcome === "none" ||
      primaryOutcome === "missing" ||
      primaryOutcome === "unchanged")
  ) {
    return "canceled";
  }
  return primaryOutcome;
}

/** Status em que a Stripe já encerrou a cobrança (não agendar cancel_at_period_end). */
export function isTerminalBillingSubscriptionStatus(
  status: Stripe.Subscription.Status,
): boolean {
  return status === "canceled" || status === "incomplete_expired";
}

/**
 * Inclui no mapa só assinaturas ainda abertas para cobrança.
 * `cancel_at_period_end` sozinho NÃO basta — sub já `canceled`/`incomplete_expired`
 * pode manter a flag e não deve ser tratada como "agendada".
 */
export function shouldCollectSubscriptionForCancel(
  status: Stripe.Subscription.Status,
): boolean {
  return isOpenBillingSubscriptionStatus(status);
}

function isStripeResourceMissing(err: unknown): boolean {
  return (
    err instanceof Stripe.errors.StripeInvalidRequestError &&
    err.code === "resource_missing"
  );
}

async function collectOpenSubscriptions(
  stripe: Stripe,
  customerId: string | null,
  knownSubscriptionId: string | null,
): Promise<{
  byId: Map<string, Stripe.Subscription>;
  customerMissing: boolean;
}> {
  const byId = new Map<string, Stripe.Subscription>();
  let customerMissing = false;

  if (knownSubscriptionId) {
    try {
      const sub = await stripe.subscriptions.retrieve(knownSubscriptionId);
      if (shouldCollectSubscriptionForCancel(sub.status)) {
        byId.set(sub.id, sub);
      }
    } catch (err) {
      if (!isStripeResourceMissing(err)) throw err;
    }
  }

  if (customerId) {
    try {
      const listed = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 20,
      });
      for (const sub of listed.data) {
        if (shouldCollectSubscriptionForCancel(sub.status)) {
          byId.set(sub.id, sub);
        }
      }
    } catch (err) {
      // Customer stale/apagado: equivalente a nada a listar (não abortar cancel/delete).
      if (!isStripeResourceMissing(err)) throw err;
      customerMissing = true;
    }
  }

  return { byId, customerMissing };
}

/**
 * Cancela cobrança Stripe ligada ao utilizador.
 *
 * - `account_delete`: cancela todas as assinaturas abertas **já** e apaga o Customer
 *   (equivalente ao que era feito manualmente no Dashboard).
 * - `subscription_cancel`: trial/incomplete/past_due/unpaid → cancel imediato;
 *   active pago → `cancel_at_period_end` (acesso até o fim do período já pago).
 *   Leftovers do mesmo customer também são tratados, mas `primaryOutcome` reflete
 *   só a assinatura em `stripeSubscriptionId` (evita limpar plano pago por engano).
 */
export async function cancelStripeBillingForUser(
  input: CancelStripeBillingInput,
): Promise<CancelStripeBillingResult> {
  const customerId = input.stripeCustomerId?.trim() || null;
  const subscriptionId = input.stripeSubscriptionId?.trim() || null;
  const empty: CancelStripeBillingResult = {
    ok: true,
    skipped: true,
    canceledSubscriptionIds: [],
    scheduledCancelAtPeriodEndIds: [],
    deletedCustomer: false,
    endedTrialImmediately: false,
    primaryOutcome: "none",
  };

  if (!customerId && !subscriptionId) {
    return empty;
  }

  const stripe = getStripeClient();
  if (!stripe) {
    return {
      ...empty,
      ok: false,
      skipped: false,
      error: "Stripe não configurado (STRIPE_SECRET_KEY ausente).",
    };
  }

  const canceledSubscriptionIds: string[] = [];
  const scheduledCancelAtPeriodEndIds: string[] = [];
  let endedTrialImmediately = false;
  let deletedCustomer = false;
  let primaryOutcome: CancelStripeBillingResult["primaryOutcome"] = subscriptionId
    ? "missing"
    : "none";

  try {
    const { byId: openSubs, customerMissing } = await collectOpenSubscriptions(
      stripe,
      customerId,
      subscriptionId,
    );

    for (const sub of openSubs.values()) {
      const isPrimary = Boolean(subscriptionId && sub.id === subscriptionId);

      // Defesa: status terminal nunca entra como "scheduled" (mesmo se cancel_at_period_end).
      if (isTerminalBillingSubscriptionStatus(sub.status)) {
        if (isPrimary) primaryOutcome = "canceled";
        continue;
      }

      const immediate = shouldCancelSubscriptionImmediately(input.mode, sub.status);
      if (immediate) {
        await stripe.subscriptions.cancel(sub.id, {
          prorate: false,
          invoice_now: false,
        });
        canceledSubscriptionIds.push(sub.id);
        if (sub.status === "trialing") endedTrialImmediately = true;
        if (isPrimary) primaryOutcome = "canceled";
      } else if (!sub.cancel_at_period_end) {
        await stripe.subscriptions.update(sub.id, {
          cancel_at_period_end: true,
        });
        scheduledCancelAtPeriodEndIds.push(sub.id);
        if (isPrimary) primaryOutcome = "scheduled";
      } else {
        scheduledCancelAtPeriodEndIds.push(sub.id);
        if (isPrimary) primaryOutcome = "scheduled";
      }
    }

    // Primary estava na lista com cancel_at_period_end já true mas status open:
    // collect inclui via known id; loop acima marca scheduled.
    // Se o id conhecido não entrou em openSubs (já canceled / incomplete_expired):
    if (subscriptionId && primaryOutcome === "missing" && !openSubs.has(subscriptionId)) {
      try {
        const primary = await stripe.subscriptions.retrieve(subscriptionId);
        if (isTerminalBillingSubscriptionStatus(primary.status)) {
          primaryOutcome = "canceled";
        } else if (
          shouldCollectSubscriptionForCancel(primary.status) &&
          primary.cancel_at_period_end
        ) {
          primaryOutcome = "scheduled";
          if (!scheduledCancelAtPeriodEndIds.includes(primary.id)) {
            scheduledCancelAtPeriodEndIds.push(primary.id);
          }
        } else if (shouldCollectSubscriptionForCancel(primary.status)) {
          primaryOutcome = "unchanged";
        } else {
          primaryOutcome = "canceled";
        }
      } catch (err) {
        if (isStripeResourceMissing(err)) {
          primaryOutcome = "canceled";
        } else {
          throw err;
        }
      }
    }

    // Customer já apagado na Stripe e nada aberto → cobrança já encerrada.
    if (
      customerMissing &&
      openSubs.size === 0 &&
      scheduledCancelAtPeriodEndIds.length === 0 &&
      (primaryOutcome === "none" || primaryOutcome === "missing")
    ) {
      primaryOutcome = "canceled";
    }

    // Nada aberto para cobrar (já canceled / só customer id residual) → sucesso idempotente.
    if (
      openSubs.size === 0 &&
      scheduledCancelAtPeriodEndIds.length === 0 &&
      canceledSubscriptionIds.length === 0 &&
      (primaryOutcome === "none" ||
        primaryOutcome === "missing" ||
        primaryOutcome === "unchanged")
    ) {
      primaryOutcome = "canceled";
    }

    // Normaliza outcome para o utilizador (não só o id em User.stripeSubscriptionId):
    // - Sem primary id + leftovers agendados/cancelados → não deixar "none".
    // - Primary já morto + leftover pago com cancel_at_period_end → "scheduled".
    primaryOutcome = resolveUserFacingPrimaryOutcome(
      subscriptionId,
      primaryOutcome,
      canceledSubscriptionIds.length,
      scheduledCancelAtPeriodEndIds.length,
    );

    if (input.mode === "account_delete" && customerId) {
      try {
        await stripe.customers.del(customerId);
        deletedCustomer = true;
      } catch (err) {
        if (isStripeResourceMissing(err)) {
          deletedCustomer = true;
        } else {
          throw err;
        }
      }
    }

    console.log(
      "[stripe-billing-cancel]",
      JSON.stringify({
        mode: input.mode,
        userId: input.userId ?? null,
        customerId,
        subscriptionId,
        primaryOutcome,
        canceledSubscriptionIds,
        scheduledCancelAtPeriodEndIds,
        deletedCustomer,
        endedTrialImmediately,
      }),
    );

    return {
      ok: true,
      skipped: false,
      canceledSubscriptionIds,
      scheduledCancelAtPeriodEndIds,
      deletedCustomer,
      endedTrialImmediately,
      primaryOutcome,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha ao cancelar na Stripe.";
    console.error("[stripe-billing-cancel]", {
      mode: input.mode,
      userId: input.userId,
      customerId,
      subscriptionId,
      message,
    });
    return {
      ok: false,
      skipped: false,
      canceledSubscriptionIds,
      scheduledCancelAtPeriodEndIds,
      deletedCustomer,
      endedTrialImmediately,
      primaryOutcome,
      error: message,
    };
  }
}
