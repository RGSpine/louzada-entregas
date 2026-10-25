"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { clinicalPanelTransition } from "@/design/motion-presets";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/utils";
import {
  planCardBaseClass,
  planCardDescriptionClass,
  planCardFeaturedClass,
  planCardTitleClass,
  planFeatureItemClass,
  planFeatureListClass,
} from "@/components/planos/plan-pricing-styles";

const MOBILE_FEATURE_PREVIEW = 2;

type Props = {
  variant?: "default" | "featured";
  badge?: string;
  title: ReactNode;
  description: string;
  price: ReactNode;
  features: string[];
  footer: ReactNode;
  index?: number;
  className?: string;
  /** Mobile carrossel — preview curto + botão para sheet. Desktop ignora. */
  featuresMode?: "full" | "compact";
  onViewAllFeatures?: () => void;
};

export function PlanPricingCard({
  variant = "default",
  badge,
  title,
  description,
  price,
  features,
  footer,
  index = 0,
  className,
  featuresMode = "full",
  onViewAllFeatures,
}: Props) {
  const reduced = useReducedMotion();
  const featured = variant === "featured";
  const isCompact = featuresMode === "compact";
  const visibleFeatures = isCompact ? features.slice(0, MOBILE_FEATURE_PREVIEW) : features;
  const hiddenCount = isCompact ? Math.max(features.length - visibleFeatures.length, 0) : 0;

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...clinicalPanelTransition, delay: reduced ? 0 : index * 0.06 }}
      whileHover={reduced ? undefined : { y: featured ? -4 : -2 }}
      className={cn("h-full", badge && "relative pt-4", className)}
    >
      <Card className={cn("relative h-full", featured ? planCardFeaturedClass : planCardBaseClass)}>
        {badge ? (
          <div className="absolute -top-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground shadow-[var(--shadow-elevation-1)]">
            {badge}
          </div>
        ) : null}
        <CardHeader className="space-y-3 pb-2">
          <div className={planCardTitleClass}>{title}</div>
          <p className={planCardDescriptionClass}>{description}</p>
          {price}
        </CardHeader>
        <CardContent className="flex flex-col">
          <ul className={cn(planFeatureListClass, isCompact && "mb-3")}>
            {visibleFeatures.map((feature) => (
              <li key={feature} className={planFeatureItemClass}>
                <Check
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0",
                    featured ? "text-primary" : "text-success",
                  )}
                  aria-hidden
                />
                <span>{feature}</span>
              </li>
            ))}
          </ul>

          {isCompact && onViewAllFeatures ? (
            <Button
              type="button"
              variant="outline"
              className="mb-4 w-full border-primary/30 text-primary hover:bg-primary/5"
              onClick={onViewAllFeatures}
            >
              Ver tudo que inclui
              {hiddenCount > 0 ? ` (+${hiddenCount})` : ""}
            </Button>
          ) : null}

          <div className={cn(!isCompact && "mt-auto", "pt-0")}>{footer}</div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
