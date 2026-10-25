"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { useCreative3dCapability } from "@/lib/creative-3d/useCreative3dCapability";
import { JarvisCanvasLazy } from "@/components/creative-3d/canvas/JarvisCanvasLazy";
import { JarvisOrbFallback } from "@/components/creative-3d/fallback/JarvisOrbFallback";
import type { JarvisOrbButtonProps } from "@/components/creative-3d/types";

const DEFAULT_SIZE = 256;

/**
 * Botão circular “IA viva” — WebGL (R3F) com fallback Motion/CSS.
 * Padrão de referência para futuros controles (ex.: gravação de evolução).
 *
 * Bridge Motion + R3F: estado visual no React; animação 3D no `useFrame` do mesh.
 * Equivalente moderno ao ecossistema framer-motion-3d (Motion v12 + R3F).
 */
export function JarvisOrbButton({
  state: stateProp = "idle",
  onClick,
  disabled = false,
  className,
  size = DEFAULT_SIZE,
  "aria-label": ariaLabel,
  "aria-pressed": ariaPressed,
}: JarvisOrbButtonProps) {
  const reduced = useReducedMotion();
  const capability = useCreative3dCapability();
  const [hovered, setHovered] = useState(false);

  const visualState = disabled ? "disabled" : hovered ? "hover" : stateProp;
  const useWebgl = capability.tier === "webgl" && !reduced;

  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      whileTap={reduced || disabled ? undefined : { scale: 0.97 }}
      className={cn(
        "relative inline-flex items-center justify-center overflow-hidden rounded-full",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {useWebgl ? (
        <JarvisCanvasLazy
          state={visualState}
          autoRotate={!reduced}
          className="absolute inset-0"
        />
      ) : (
        <JarvisOrbFallback state={visualState} size={size} className="absolute inset-0" />
      )}

      {/* Camada de foco acessível — hit target garantido */}
      <span className="sr-only">{ariaLabel}</span>
    </motion.button>
  );
}
