"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PlanFeaturesSheet } from "@/components/planos/PlanFeaturesSheet";
import { PlanPricingCard } from "@/components/planos/PlanPricingCard";
import { landingMobileNavButtonClass } from "@/components/landing/landing-panel-styles";
import { cn } from "@/lib/utils";

export type MobilePlanCardDef = {
  key: string;
  variant?: "default" | "featured";
  badge?: string;
  title: ReactNode;
  description: string;
  price: ReactNode;
  features: string[];
  footer: ReactNode;
  sheetTitle: string;
};

type Props = {
  plans: MobilePlanCardDef[];
  /** Reinicia carrossel ao trocar segmento ou billing. */
  resetKey: string;
};

export function PlanPricingCardsMobileCarousel({ plans, resetKey }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [sheetPlanKey, setSheetPlanKey] = useState<string | null>(null);

  const sheetPlan = plans.find((p) => p.key === sheetPlanKey) ?? null;

  const updateActiveIndex = useCallback(() => {
    const el = scrollRef.current;
    if (!el || el.clientWidth <= 0) return;
    const index = Math.round(el.scrollLeft / el.clientWidth);
    setActiveIndex(Math.min(Math.max(index, 0), plans.length - 1));
  }, [plans.length]);

  const scrollToIndex = useCallback(
    (index: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const clamped = Math.min(Math.max(index, 0), plans.length - 1);
      el.scrollTo({ left: clamped * el.clientWidth, behavior: "smooth" });
      setActiveIndex(clamped);
    },
    [plans.length],
  );

  useEffect(() => {
    setActiveIndex(0);
    setSheetPlanKey(null);
    const el = scrollRef.current;
    if (el) el.scrollLeft = 0;
  }, [resetKey, plans.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateActiveIndex();
    el.addEventListener("scroll", updateActiveIndex, { passive: true });
    window.addEventListener("resize", updateActiveIndex);
    return () => {
      el.removeEventListener("scroll", updateActiveIndex);
      window.removeEventListener("resize", updateActiveIndex);
    };
  }, [updateActiveIndex, plans.length]);

  if (plans.length === 0) return null;

  return (
    <>
      <div className="md:hidden pt-1">
        <div className="flex items-stretch gap-2">
          <button
            type="button"
            className={cn(landingMobileNavButtonClass, "self-center")}
            disabled={activeIndex <= 0}
            aria-label="Plano anterior"
            onClick={() => scrollToIndex(activeIndex - 1)}
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>

          <div
            ref={scrollRef}
            className="flex min-w-0 flex-1 snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-roledescription="carrossel"
            aria-label="Planos disponíveis"
          >
            {plans.map((plan, index) => (
              <div
                key={plan.key}
                className="w-full shrink-0 snap-center"
                aria-hidden={index !== activeIndex}
              >
                <PlanPricingCard
                  index={index}
                  variant={plan.variant}
                  badge={plan.badge}
                  title={plan.title}
                  description={plan.description}
                  price={plan.price}
                  features={plan.features}
                  featuresMode="compact"
                  onViewAllFeatures={() => setSheetPlanKey(plan.key)}
                  footer={plan.footer}
                />
              </div>
            ))}
          </div>

          <button
            type="button"
            className={cn(landingMobileNavButtonClass, "self-center")}
            disabled={activeIndex >= plans.length - 1}
            aria-label="Próximo plano"
            onClick={() => scrollToIndex(activeIndex + 1)}
          >
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <p className="mt-3 text-center text-xs font-medium text-muted-foreground">
          Plano {activeIndex + 1} de {plans.length}
        </p>
      </div>

      <PlanFeaturesSheet
        open={sheetPlan !== null}
        onClose={() => setSheetPlanKey(null)}
        title={sheetPlan?.sheetTitle ?? ""}
        description={sheetPlan?.description}
        features={sheetPlan?.features ?? []}
        featured={sheetPlan?.variant === "featured"}
      />
    </>
  );
}
