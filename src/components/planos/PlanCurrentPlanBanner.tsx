"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";
import { Check, Crown, Zap } from "lucide-react";
import { clinicalPanelTransition } from "@/design/motion-presets";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { planDisplayName, type PlanTier } from "@/lib/plan-tier";
import { cn } from "@/lib/utils";

type Props = {
  plan: PlanTier;
  planInterval?: "MONTHLY" | "ANNUAL" | null;
  renewalLabel?: string | null;
  trailing?: ReactNode;
  className?: string;
};

function PlanIcon({ plan }: { plan: PlanTier }) {
  if (plan === "PREMIUM" || plan === "CLINICA") {
    return <Crown className="h-4 w-4 shrink-0" aria-hidden />;
  }
  if (plan === "PROFISSIONAL" || plan === "CONSULTORIO") {
    return <Zap className="h-4 w-4 shrink-0" aria-hidden />;
  }
  return <Check className="h-4 w-4 shrink-0" aria-hidden />;
}

export function PlanCurrentPlanBanner({
  plan,
  planInterval,
  renewalLabel,
  trailing,
  className,
}: Props) {
  const reduced = useReducedMotion();

  return (
    <motion.section
      className={cn(
        "mb-8 min-w-0 overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/15 via-card to-card shadow-[var(--shadow-elevation-2)] dark:border-primary/35 dark:from-primary/20 dark:via-card dark:to-card",
        className,
      )}
      initial={reduced ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={clinicalPanelTransition}
      aria-label="Seu plano atual"
    >
      <div className="h-1 bg-gradient-to-r from-primary via-clinical to-success" aria-hidden />
      <div className="flex min-w-0 flex-col gap-3 px-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4 sm:px-6 sm:py-6">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          <span className="text-xs font-bold uppercase tracking-widest text-primary sm:text-sm">
            Seu plano atual
          </span>
          <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-sm font-bold text-primary-foreground shadow-[var(--shadow-elevation-2)] ring-2 ring-primary/30 sm:px-4 sm:py-2">
            <PlanIcon plan={plan} />
            <span className="truncate">{planDisplayName(plan)}</span>
            {planInterval ? (
              <span className="shrink-0 text-xs font-semibold opacity-90">
                ({planInterval === "ANNUAL" ? "Anual" : "Mensal"})
              </span>
            ) : null}
          </span>
          {renewalLabel ? (
            <span className="text-sm font-medium text-foreground/75">{renewalLabel}</span>
          ) : null}
        </div>
        {trailing ? (
          <div className="w-full min-w-0 break-words rounded-xl border border-primary/25 bg-background/60 px-3 py-3 text-left text-sm shadow-[var(--shadow-elevation-1)] backdrop-blur-sm dark:bg-background/40 sm:max-w-md sm:shrink-0 sm:px-4 sm:text-right">
            {trailing}
          </div>
        ) : null}
      </div>
    </motion.section>
  );
}
