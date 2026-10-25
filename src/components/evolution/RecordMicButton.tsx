"use client";

import Lottie from "lottie-react";
import { motion } from "motion/react";
import recordingMicAnim from "@/assets/recording-mic.json";
import { recordButtonVariants } from "@/design/motion-presets";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/utils";

type RecordMicButtonProps = {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
};

/** Botão circular de gravação — spring + pulse suave (Clinical Calm) */
export function RecordMicButton({ onClick, disabled, className }: RecordMicButtonProps) {
  const reduced = useReducedMotion();

  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      variants={reduced ? undefined : recordButtonVariants}
      initial="idle"
      animate={reduced ? "idle" : "pulse"}
      whileTap={reduced ? undefined : "tap"}
      className={cn(
        "relative flex h-64 w-64 items-center justify-center overflow-hidden rounded-full",
        "ring-4 ring-primary/20 shadow-[var(--shadow-elevation-3)]",
        "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:opacity-50 disabled:pointer-events-none",
        className,
      )}
      aria-label="Iniciar gravação de evolução clínica"
    >
      <Lottie animationData={recordingMicAnim} loop className="h-full w-full" />
    </motion.button>
  );
}
