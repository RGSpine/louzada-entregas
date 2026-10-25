"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { UpgradeButton } from "@/components/stripe/UpgradeButton";
import { DowngradeButton } from "@/components/planos/DowngradeButton";
import { ManageMySubscriptionButton } from "@/components/planos/ManageMySubscriptionButton";
import { validateCouponForDisplay } from "@/app/actions/coupon";
import { canUseCheckoutCoupon } from "@/lib/coupon-eligibility";
import {
  isCurrentPlanTier,
  isDowngradeTarget,
  isUpgradeTarget,
  planDisplayName,
  type CheckoutPlanType,
  type PlanTier,
} from "@/lib/plan-tier";

const COUPON_DEBOUNCE_MS = 600;
const COUPON_MIN_LENGTH = 3;

type Props = {
  cardPlan: PlanTier;
  currentPlan: PlanTier | null;
  fromSignup: boolean;
  /** Sem plano ativo — mostrar Assinar em todos os cards (não marcar "atual"). */
  needsCheckout?: boolean;
  isInfluencer: boolean;
  isOwnerLifetimePro: boolean;
  hasStripeSubscription: boolean;
  currentPeriodEnd: Date | null;
  interval: "MONTHLY" | "ANNUAL";
  /** Desconto válido deste card (pai do card — já montado). */
  onCouponDiscountChange?: (discountPercent: number | null) => void;
};

function CouponField({
  fieldId,
  allowsCoupon,
  onCouponDiscountChange,
  renderCheckout,
}: {
  fieldId: string;
  allowsCoupon: boolean;
  onCouponDiscountChange?: (discountPercent: number | null) => void;
  renderCheckout: (
    couponCode: string | undefined,
    onCouponAlreadyUsed: () => void,
  ) => ReactNode;
}) {
  const [couponCode, setCouponCode] = useState("");
  const [couponErrorMessage, setCouponErrorMessage] = useState("");
  const [couponValidating, setCouponValidating] = useState(false);
  const onDiscountRef = useRef(onCouponDiscountChange);
  const lastReportedRef = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    onDiscountRef.current = onCouponDiscountChange;
  }, [onCouponDiscountChange]);

  useEffect(() => {
    if (!allowsCoupon) return;

    const normalized = couponCode.trim().toUpperCase();
    if (!normalized || normalized.length < COUPON_MIN_LENGTH) {
      // Não notifica o pai no mount (evita setState em árvore ainda montando).
      // Só limpa desconto se já tínhamos reportado um valor.
      if (lastReportedRef.current != null) {
        lastReportedRef.current = null;
        onDiscountRef.current?.(null);
      }
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      setCouponValidating(true);
      void validateCouponForDisplay(normalized)
        .then((result) => {
          if (cancelled) return;
          if (result.success) {
            if (result.alreadyRedeemed) {
              lastReportedRef.current = null;
              onDiscountRef.current?.(null);
              setCouponErrorMessage("Você já usou seu cupom único.");
              return;
            }
            lastReportedRef.current = result.percentOff;
            onDiscountRef.current?.(result.percentOff);
            setCouponErrorMessage("");
            return;
          }
          lastReportedRef.current = null;
          onDiscountRef.current?.(null);
          setCouponErrorMessage(result.error);
        })
        .catch(() => {
          if (cancelled) return;
          lastReportedRef.current = null;
          onDiscountRef.current?.(null);
          setCouponErrorMessage("Não foi possível validar o cupom.");
        })
        .finally(() => {
          if (!cancelled) setCouponValidating(false);
        });
    }, COUPON_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [allowsCoupon, couponCode]);

  if (!allowsCoupon) {
    return <>{renderCheckout(undefined, () => undefined)}</>;
  }

  return (
    <div className="space-y-2">
      <input
        type="text"
        id={fieldId}
        name={fieldId}
        value={couponCode}
        onChange={(event) => {
          const next = event.target.value.toUpperCase();
          setCouponCode(next);
          setCouponErrorMessage("");
          if (!next.trim() && lastReportedRef.current != null) {
            lastReportedRef.current = null;
            onDiscountRef.current?.(null);
          }
        }}
        placeholder="CUPOM (OPCIONAL)"
        autoComplete="off"
        className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm uppercase tracking-wide text-foreground placeholder:text-muted-foreground"
      />
      {couponValidating ? (
        <p className="text-xs text-muted-foreground">Validando cupom…</p>
      ) : null}
      {couponErrorMessage ? (
        <p className="text-xs text-destructive">{couponErrorMessage}</p>
      ) : null}
      {renderCheckout(couponCode.trim() || undefined, () =>
        setCouponErrorMessage("Você já usou seu cupom único."),
      )}
    </div>
  );
}

export function PlanCardActions({
  cardPlan,
  currentPlan,
  fromSignup,
  needsCheckout = false,
  isInfluencer,
  isOwnerLifetimePro,
  hasStripeSubscription,
  currentPeriodEnd,
  interval,
  onCouponDiscountChange,
}: Props) {
  const isLifetimeOrPartner = isInfluencer || isOwnerLifetimePro;
  const choosingPlan = needsCheckout || fromSignup || !hasStripeSubscription || !currentPlan;
  const allowsCoupon = canUseCheckoutCoupon(currentPlan, fromSignup || needsCheckout);
  const fieldId = `coupon-${cardPlan.toLowerCase()}`;

  if (choosingPlan && !isLifetimeOrPartner) {
    const planType = cardPlan as CheckoutPlanType;
    // Trial de 14 dias vale para todos os planos no checkout — label curto para não quebrar o botão.
    const label = `Assinar ${planDisplayName(planType)} · 14 dias grátis`;

    return (
      <CouponField
        fieldId={fieldId}
        allowsCoupon={allowsCoupon}
        onCouponDiscountChange={onCouponDiscountChange}
        renderCheckout={(couponCode, onCouponAlreadyUsed) => (
          <UpgradeButton
            planType={planType}
            interval={interval}
            couponCode={couponCode}
            onCouponAlreadyUsed={onCouponAlreadyUsed}
          >
            {label}
          </UpgradeButton>
        )}
      />
    );
  }

  if (isCurrentPlanTier(currentPlan, cardPlan)) {
    if ((!currentPlan || cardPlan === "BASICO") && !hasStripeSubscription && !isLifetimeOrPartner) {
      return (
        <CouponField
          fieldId={fieldId}
          allowsCoupon={allowsCoupon}
          onCouponDiscountChange={onCouponDiscountChange}
          renderCheckout={(couponCode, onCouponAlreadyUsed) => (
            <UpgradeButton
              planType="BASICO"
              interval={interval}
              couponCode={couponCode}
              onCouponAlreadyUsed={onCouponAlreadyUsed}
            >
              Assinar Básico · 14 dias grátis
            </UpgradeButton>
          )}
        />
      );
    }

    if ((cardPlan === "PREMIUM" || cardPlan === "CLINICA") && isInfluencer) {
      return (
        <p className="py-2 text-center text-sm text-success">
          Seu PRO é via parceria (Influencer).
        </p>
      );
    }

    if ((cardPlan === "PREMIUM" || cardPlan === "CLINICA") && isOwnerLifetimePro) {
      return (
        <p className="py-2 text-center text-sm text-success">
          Plano PREMIUM vitalício — sem assinatura Stripe.
        </p>
      );
    }

    return (
      <ManageMySubscriptionButton
        currentPlan={currentPlan}
        hasStripeSubscription={hasStripeSubscription}
      />
    );
  }

  if (currentPlan && isUpgradeTarget(currentPlan, cardPlan)) {
    const planType = cardPlan as CheckoutPlanType;
    const upgradeLabel = `Upgrade para ${planDisplayName(planType)}`;

    return (
      <CouponField
        fieldId={fieldId}
        allowsCoupon={allowsCoupon}
        onCouponDiscountChange={onCouponDiscountChange}
        renderCheckout={(couponCode, onCouponAlreadyUsed) => (
          <UpgradeButton
            planType={planType}
            interval={interval}
            couponCode={couponCode}
            onCouponAlreadyUsed={onCouponAlreadyUsed}
          >
            {upgradeLabel}
          </UpgradeButton>
        )}
      />
    );
  }

  if (currentPlan && isDowngradeTarget(currentPlan, cardPlan)) {
    if (isLifetimeOrPartner) {
      return (
        <p className="py-2 text-center text-xs text-muted-foreground">
          Seu acesso PRO especial não usa downgrade por assinatura.
        </p>
      );
    }

    if (!hasStripeSubscription) {
      return (
        <p className="py-2 text-center text-xs text-muted-foreground">
          Sem assinatura Stripe ativa para alterar.
        </p>
      );
    }

    const targetPlan = cardPlan === "BASICO" ? "BASICO" : "PROFISSIONAL";
    if (currentPlan === "PROFISSIONAL" && cardPlan === "PROFISSIONAL") return null;
    if (currentPlan === "CONSULTORIO" && cardPlan === "CONSULTORIO") return null;

    return (
      <div className="space-y-2">
        <DowngradeButton
          targetPlan={targetPlan}
          currentPeriodEnd={currentPeriodEnd}
        />
        <p className="text-center text-xs text-muted-foreground">
          Sem estorno. Benefícios atuais até o fim do período pago.
        </p>
      </div>
    );
  }

  return null;
}
