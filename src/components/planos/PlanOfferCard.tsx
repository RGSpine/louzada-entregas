"use client";

import { useCallback, useState, type ReactNode } from "react";
import { PlanCardActions } from "@/components/planos/PlanCardActions";
import { PlanPriceDisplay } from "@/components/planos/PlanPriceDisplay";
import { PlanPricingCard } from "@/components/planos/PlanPricingCard";
import type { PlanTier } from "@/lib/plan-tier";

type PriceProps = {
  perMonthPrice: number;
  annualTotalPrice?: number;
  isAnnual: boolean;
  featured?: boolean;
};

type ActionsProps = {
  cardPlan: PlanTier;
  currentPlan: PlanTier | null;
  fromSignup: boolean;
  needsCheckout?: boolean;
  isInfluencer: boolean;
  isOwnerLifetimePro: boolean;
  hasStripeSubscription: boolean;
  currentPeriodEnd: Date | null;
  interval: "MONTHLY" | "ANNUAL";
  couponEligible: boolean;
};

type Props = {
  variant?: "default" | "featured";
  badge?: string;
  title: ReactNode;
  description: string;
  features: string[];
  index?: number;
  price: PriceProps;
  actions: ActionsProps;
};

/**
 * Card de plano com cupom + desconto no preço no mesmo estado local.
 * Evita setState no pai da página durante o mount (crash React).
 */
export function PlanOfferCard({
  variant,
  badge,
  title,
  description,
  features,
  index,
  price,
  actions,
}: Props) {
  const [discountPercent, setDiscountPercent] = useState<number | null>(null);

  const onCouponDiscountChange = useCallback((percent: number | null) => {
    setDiscountPercent(percent);
  }, []);

  return (
    <PlanPricingCard
      index={index}
      variant={variant}
      badge={badge}
      title={title}
      description={description}
      features={features}
      price={
        <PlanPriceDisplay
          perMonthPrice={price.perMonthPrice}
          annualTotalPrice={price.annualTotalPrice}
          isAnnual={price.isAnnual}
          discountPercent={actions.couponEligible ? discountPercent : null}
          featured={price.featured}
        />
      }
      footer={
        <PlanCardActions
          cardPlan={actions.cardPlan}
          currentPlan={actions.currentPlan}
          fromSignup={actions.fromSignup}
          needsCheckout={actions.needsCheckout}
          isInfluencer={actions.isInfluencer}
          isOwnerLifetimePro={actions.isOwnerLifetimePro}
          hasStripeSubscription={actions.hasStripeSubscription}
          currentPeriodEnd={actions.currentPeriodEnd}
          interval={actions.interval}
          onCouponDiscountChange={onCouponDiscountChange}
        />
      }
    />
  );
}
