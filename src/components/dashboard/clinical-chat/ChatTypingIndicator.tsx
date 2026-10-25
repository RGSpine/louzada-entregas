"use client";

import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";

const DOT_DELAYS = [0, 0.12, 0.24] as const;

/** Indicador de digitação IA — spring Clinical Calm (≤400ms por ciclo) */
export function ChatTypingIndicator() {
  const reduced = useReducedMotion();

  if (reduced) {
    return (
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-clinical" aria-hidden />
    );
  }

  return (
    <span className="flex gap-1" aria-hidden>
      {DOT_DELAYS.map((delay) => (
        <motion.span
          key={delay}
          className="h-1.5 w-1.5 rounded-full bg-clinical"
          animate={{ y: [0, -3, 0], opacity: [0.45, 1, 0.45] }}
          transition={{
            duration: 0.55,
            repeat: Infinity,
            ease: "easeInOut",
            delay,
          }}
        />
      ))}
    </span>
  );
}
