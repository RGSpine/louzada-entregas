"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";
import { clinicalPanelTransition } from "@/design/motion-presets";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { landingPanelLeadClass } from "@/components/landing/landing-panel-styles";
import { cn } from "@/lib/utils";

type Props = {
  title?: string;
  subtitle?: string;
  children?: ReactNode;
  className?: string;
};

export function PlanPageHero({
  title = "Planos",
  subtitle = "Escolha o plano ideal para seu uso do Louzada Entregas",
  children,
  className,
}: Props) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      className={cn("mb-8 text-center", className)}
      initial={reduced ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={clinicalPanelTransition}
    >
      <h1 className="mb-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        {title}
      </h1>
      <p className={cn(landingPanelLeadClass, "mb-6")}>
        {subtitle}
      </p>
      {children}
    </motion.div>
  );
}
