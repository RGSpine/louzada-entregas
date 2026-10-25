"use client";

import Link from "next/link";
import { Check, Crown, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PlanSegment } from "@/lib/plan-tier";
import {
  PRICING,
  freePlanFeatures,
  getPlanLimits,
  proClinicaPlanFeatures,
  proPlanFeatures,
  starterClinicaPlanFeatures,
  starterPlanFeatures,
} from "@/lib/plan-pricing-display";
import { PlanPricingCard } from "@/components/planos/PlanPricingCard";
import {
  PlanPricingCardsMobileCarousel,
  type MobilePlanCardDef,
} from "@/components/planos/PlanPricingCardsMobileCarousel";
import { useMemo } from "react";

export const PLAN_PRIMARY_CTA_CLASS =
  "flex h-auto min-h-12 w-full items-center justify-center whitespace-normal bg-primary px-4 py-5 text-center text-base font-semibold leading-snug text-primary-foreground shadow-[var(--shadow-elevation-3)] transition-all hover:scale-[1.02] hover:bg-primary/90 hover:shadow-[var(--shadow-elevation-3)] sm:px-8 sm:py-6 sm:text-lg";

/** CTA principal no topo da página pública de planos — destaque acima dos cards. */
export const PLAN_SIGNUP_HERO_CTA_CLASS =
  "h-auto min-h-10 w-full whitespace-normal bg-primary px-5 py-3 text-xl font-semibold leading-tight text-primary-foreground shadow-[var(--shadow-elevation-3)] transition-all hover:scale-[1.02] hover:bg-primary/90 hover:shadow-[var(--shadow-elevation-3)] md:min-h-14 md:px-8 md:py-5 md:text-3xl";

type Props = {
  segment: PlanSegment;
  isAnnual: boolean;
};

function PriceBlock({
  monthly,
  annualPerMonth,
  annualTotal,
  isAnnual,
  featured = false,
}: {
  monthly: string;
  annualPerMonth: string;
  annualTotal: string;
  isAnnual: boolean;
  featured?: boolean;
}) {
  const priceClass = featured
    ? "text-4xl font-extrabold tracking-tight text-primary"
    : "text-4xl font-extrabold tracking-tight text-foreground";

  if (isAnnual) {
    return (
      <div className="mt-1">
        <span className={priceClass}>R$ {annualPerMonth}</span>
        <span className="ml-1.5 text-sm font-medium text-foreground/65">/mês</span>
        <p className="mt-1.5 text-xs font-medium text-foreground/60">
          Cobrado anualmente: R$ {annualTotal}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-1">
      <span className={priceClass}>R$ {monthly}</span>
      <span className="ml-1.5 text-sm font-medium text-foreground/65">/mês</span>
    </div>
  );
}

function signupFooter() {
  return (
    <Button className={PLAN_PRIMARY_CTA_CLASS} asChild>
      <Link href="/register">Cadastre-se para assinar</Link>
    </Button>
  );
}

export function PlanPricingCardsPublic({ segment, isAnnual }: Props) {
  const isClinica = segment === "CLINICA";
  const profissionalPricing = isClinica ? PRICING.CONSULTORIO : PRICING.PROFISSIONAL;
  const premiumPricing = isClinica ? PRICING.CLINICA : PRICING.PREMIUM;
  const profissionalTitle = isClinica ? "Consultório" : "Profissional";
  const premiumTitle = isClinica ? "Clínica" : "Premium";
  const starterFeatures = isClinica
    ? starterClinicaPlanFeatures(getPlanLimits("PREMIUM"))
    : starterPlanFeatures(getPlanLimits("PROFISSIONAL"));
  const proFeatures = isClinica
    ? proClinicaPlanFeatures(getPlanLimits("PREMIUM"))
    : proPlanFeatures(getPlanLimits("PREMIUM"));

  const plans = useMemo((): MobilePlanCardDef[] => {
    const list: MobilePlanCardDef[] = [];

    if (!isClinica) {
      list.push({
        key: "basico",
        title: (
          <>
            <Check className="h-5 w-5 text-muted-foreground" aria-hidden />
            Básico
          </>
        ),
        sheetTitle: "Plano Básico",
        description: "Essencial para sua rotina — 14 dias grátis ao assinar",
        price: (
          <PriceBlock
            monthly={PRICING.BASICO.monthly}
            annualPerMonth={PRICING.BASICO.annualPerMonth}
            annualTotal={PRICING.BASICO.annualTotal}
            isAnnual={isAnnual}
          />
        ),
        features: [...freePlanFeatures(getPlanLimits("BASICO")), "1 acesso simultâneo por conta"],
        footer: signupFooter(),
      });
    }

    list.push({
      key: isClinica ? "consultorio" : "profissional",
      title: (
        <>
          <Zap className="h-5 w-5 text-primary" aria-hidden />
          {profissionalTitle}
        </>
      ),
      sheetTitle: `Plano ${profissionalTitle}`,
      description: isClinica
        ? "Recursos Premium completos para equipes com até 5 acessos"
        : "Tração e engajamento na prática clínica",
      price: (
        <PriceBlock
          monthly={profissionalPricing.monthly}
          annualPerMonth={profissionalPricing.annualPerMonth}
          annualTotal={profissionalPricing.annualTotal}
          isAnnual={isAnnual}
        />
      ),
      features: !isClinica
        ? [...starterFeatures, "1 acesso simultâneo por conta"]
        : starterFeatures,
      footer: signupFooter(),
    });

    list.push({
      key: isClinica ? "clinica" : "premium",
      variant: "featured",
      badge: "Recomendado",
      title: (
        <>
          <Crown className="h-5 w-5 text-primary" aria-hidden />
          {premiumTitle}
        </>
      ),
      sheetTitle: `Plano ${premiumTitle}`,
      description: isClinica
        ? "Clínica em escala com até 10 acessos simultâneos"
        : "Escala e clínica inteligente",
      price: (
        <PriceBlock
          monthly={premiumPricing.monthly}
          annualPerMonth={premiumPricing.annualPerMonth}
          annualTotal={premiumPricing.annualTotal}
          isAnnual={isAnnual}
          featured
        />
      ),
      features: !isClinica ? [...proFeatures, "1 acesso simultâneo por conta"] : proFeatures,
      footer: signupFooter(),
    });

    return list;
  }, [
    isAnnual,
    isClinica,
    premiumTitle,
    premiumPricing.annualPerMonth,
    premiumPricing.annualTotal,
    premiumPricing.monthly,
    profissionalTitle,
    profissionalPricing.annualPerMonth,
    profissionalPricing.annualTotal,
    profissionalPricing.monthly,
    proFeatures,
    starterFeatures,
  ]);

  return (
    <>
      <PlanPricingCardsMobileCarousel
        plans={plans}
        resetKey={`${segment}-${isAnnual ? "annual" : "monthly"}`}
      />

      <div
        className={`hidden gap-6 md:grid ${isClinica ? "md:mx-auto md:max-w-3xl md:grid-cols-2" : "md:grid-cols-3"}`}
      >
        {plans.map((plan, index) => (
          <PlanPricingCard
            key={plan.key}
            index={index}
            variant={plan.variant}
            badge={plan.badge}
            title={plan.title}
            description={plan.description}
            price={plan.price}
            features={plan.features}
            footer={plan.footer}
          />
        ))}
      </div>
    </>
  );
}
