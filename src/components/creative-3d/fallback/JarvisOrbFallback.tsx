"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import type { JarvisVisualState } from "@/components/creative-3d/types";

type Props = {
  state: JarvisVisualState;
  size: number;
  className?: string;
};

const STATE_RING: Record<JarvisVisualState, string> = {
  idle: "from-clinical/30 via-primary/20 to-clinical/10",
  hover: "from-primary/40 via-clinical/30 to-primary/15",
  active: "from-primary/50 via-clinical/40 to-accent/25",
  listening: "from-success/45 via-clinical/35 to-primary/30",
  processing: "from-primary/55 via-accent/40 to-clinical/35",
  success: "from-success/40 via-clinical/25 to-primary/15",
  error: "from-destructive/35 via-destructive/20 to-muted/30",
  disabled: "from-muted/40 via-muted/20 to-muted/10",
};

/**
 * Fallback 2D (CSS + Motion) quando WebGL não está disponível
 * ou `prefers-reduced-motion` está ativo.
 */
export function JarvisOrbFallback({ state, size, className }: Props) {
  const reduced = useReducedMotion();
  const listening = state === "listening" || state === "processing";

  return (
    <motion.div
      className={cn(
        "pointer-events-none relative rounded-full bg-gradient-to-br shadow-[var(--shadow-elevation-2)]",
        STATE_RING[state],
        className,
      )}
      style={{ width: size, height: size }}
      animate={
        reduced
          ? undefined
          : {
              scale: listening ? [1, 1.04, 1] : 1,
              opacity: state === "disabled" ? 0.45 : 1,
            }
      }
      transition={
        reduced
          ? undefined
          : {
              duration: listening ? 1.4 : 0.35,
              repeat: listening ? Infinity : 0,
              ease: "easeInOut",
            }
      }
      aria-hidden
    >
      <div className="absolute inset-[18%] rounded-full bg-gradient-to-br from-clinical/80 via-primary/70 to-accent/60 blur-[1px]" />
      <div className="absolute inset-[32%] rounded-full bg-white/25 dark:bg-white/10" />
    </motion.div>
  );
}
