"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { clinicalPanelTransition } from "@/design/motion-presets";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** Alinhamento vertical — `bottom` para sheet mobile (PWA). */
  align?: "center" | "bottom";
  zIndexClass?: string;
  labelledBy?: string;
  ariaLabel?: string;
};

/** Modal Clinical Calm com entrada/saída ≤400ms e reduced-motion. */
export function ClinicalCalmModal({
  open,
  onClose,
  children,
  className,
  align = "center",
  zIndexClass = "z-50",
  labelledBy,
  ariaLabel,
}: Props) {
  const reduceMotion = useReducedMotion();

  const alignClass =
    align === "bottom"
      ? "items-end justify-center sm:items-center"
      : "items-center justify-center";

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="clinical-calm-modal"
          className={cn(
            "fixed inset-0 flex bg-black/60 p-4 backdrop-blur-sm",
            alignClass,
            zIndexClass,
          )}
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={clinicalPanelTransition}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          aria-label={ariaLabel}
        >
          <motion.div
            className={cn(
              "w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-[var(--shadow-elevation-3)]",
              className,
            )}
            initial={reduceMotion ? false : { opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={clinicalPanelTransition}
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
