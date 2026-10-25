"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { evolutionFlowVariants } from "@/design/motion-presets";
import { useReducedMotion } from "@/lib/use-reduced-motion";

type EvolutionStateTransitionProps = {
  stateKey: string;
  children: ReactNode;
  className?: string;
};

/** Transição entre estados do fluxo de evolução (initial → recording → processing → review) */
export function EvolutionStateTransition({
  stateKey,
  children,
  className,
}: EvolutionStateTransitionProps) {
  const reduced = useReducedMotion();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={stateKey}
        className={className}
        variants={reduced ? undefined : evolutionFlowVariants}
        initial={reduced ? false : "initial"}
        animate={reduced ? undefined : "animate"}
        exit={reduced ? undefined : "exit"}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
