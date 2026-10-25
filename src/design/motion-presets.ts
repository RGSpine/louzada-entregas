/**
 * Clinical Calm — presets Motion (fluxos críticos ≤400ms)
 * @see https://motion.dev/
 */

import type { Transition, Variants } from "motion/react";

/** Spring clínico — responsivo, não exagerado */
export const clinicalSpring: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 32,
  mass: 0.85,
};

/** Entrada/saída de painéis — dentro do limite crítico */
export const clinicalPanelTransition: Transition = {
  duration: 0.32,
  ease: [0.25, 0.1, 0.25, 1],
};

export const evolutionFlowVariants: Variants = {
  initial: { opacity: 0, y: 12, scale: 0.98 },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: clinicalPanelTransition,
  },
  exit: {
    opacity: 0,
    y: -8,
    scale: 0.98,
    transition: { duration: 0.22, ease: "easeIn" },
  },
};

export const recordButtonVariants: Variants = {
  idle: { scale: 1 },
  pulse: {
    scale: [1, 1.04, 1],
    transition: {
      duration: 2,
      repeat: Infinity,
      ease: "easeInOut",
    },
  },
  tap: { scale: 0.96, transition: { duration: 0.12 } },
};

/** CTA pill (ex.: white-label nos planos) — pulse mais suave que o mic */
export const clinicalCtaPillVariants: Variants = {
  idle: { scale: 1 },
  pulse: {
    scale: [1, 1.02, 1],
    transition: {
      duration: 2.5,
      repeat: Infinity,
      ease: "easeInOut",
    },
  },
  tap: { scale: 0.98, transition: { duration: 0.12 } },
};

export const processingDotVariants: Variants = {
  animate: {
    opacity: [0.4, 1, 0.4],
    transition: { duration: 1.2, repeat: Infinity, ease: "easeInOut" },
  },
};

/** Stagger para menus grouped list */
export const menuStaggerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.02 },
  },
};

export const menuItemVariants: Variants = {
  hidden: { opacity: 0, x: -6 },
  show: { opacity: 1, x: 0, transition: clinicalPanelTransition },
};

/** Landing horizontal — entrada do painel ativo */
export const landingSlideVariants: Variants = {
  hidden: { opacity: 0, x: 28 },
  visible: {
    opacity: 1,
    x: 0,
    transition: clinicalPanelTransition,
  },
};

export const landingSlideStaggerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.04 },
  },
};

export const landingSlideItemVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: clinicalPanelTransition },
};

/** Reveal no scroll vertical do painel (mobile) — esmaecido + leve blur até entrar na viewport. */
export const landingScrollRevealVariants: Variants = {
  hidden: {
    opacity: 0.38,
    y: 18,
    filter: "blur(5px)",
  },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: clinicalPanelTransition,
  },
};

export const landingScrollRevealReducedVariants: Variants = {
  hidden: { opacity: 0.55 },
  visible: { opacity: 1, transition: clinicalPanelTransition },
};

// ─── Motion 3D (Clinical Calm) — ver .cursor/skills/motion-3d/SKILL.md ───

/** Perspectiva padrão — profundidade sutil, não “arcade”. */
export const clinical3DPerspective = 1200;

/** Estilo inline para o container pai (scene root). */
export const clinical3DSceneStyle = {
  perspective: clinical3DPerspective,
  transformStyle: "preserve-3d" as const,
};

/** Transição 3D landing/onboarding — ligeiramente acima do painel clínico. */
export const clinical3DPanelTransition: Transition = {
  duration: 0.36,
  ease: [0.25, 0.1, 0.25, 1],
};

/** Spring para tilt/hover — mais amortecido que clinicalSpring. */
export const clinical3DSpring: Transition = {
  type: "spring",
  stiffness: 320,
  damping: 28,
  mass: 0.9,
};

/** Carrossel landing — painel relativo ao ativo (rotateY + z). */
export const landingPanel3DVariants: Variants = {
  inactive: {
    opacity: 0.65,
    rotateY: -10,
    scale: 0.94,
    z: -48,
    transition: clinical3DPanelTransition,
  },
  active: {
    opacity: 1,
    rotateY: 0,
    scale: 1,
    z: 0,
    transition: clinical3DPanelTransition,
  },
  peekPrev: {
    opacity: 0.82,
    rotateY: 8,
    scale: 0.97,
    z: -24,
    transition: clinical3DPanelTransition,
  },
  peekNext: {
    opacity: 0.82,
    rotateY: -8,
    scale: 0.97,
    z: -24,
    transition: clinical3DPanelTransition,
  },
};

/** Fallback 2D — mesmo contrato de estados, sem rotateY/z. */
export const landingPanel3DReducedVariants: Variants = {
  inactive: {
    opacity: 0.65,
    x: -12,
    scale: 0.98,
    transition: clinicalPanelTransition,
  },
  active: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: clinicalPanelTransition,
  },
  peekPrev: {
    opacity: 0.85,
    x: 8,
    scale: 0.99,
    transition: clinicalPanelTransition,
  },
  peekNext: {
    opacity: 0.85,
    x: -8,
    scale: 0.99,
    transition: clinicalPanelTransition,
  },
};

/** Conteúdo interno do painel ativo — stagger com leve rotateX. */
export const landingPanel3DContentVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.04 },
  },
};

export const landingPanel3DContentItemVariants: Variants = {
  hidden: { opacity: 0, y: 16, rotateX: 6 },
  visible: {
    opacity: 1,
    y: 0,
    rotateX: 0,
    transition: clinical3DPanelTransition,
  },
};

/** Hero mobile — bloco “IA” com float sutil (painel inicio). */
export const heroAccent3DVariants: Variants = {
  rest: {
    rotateX: 0,
    rotateY: 0,
    z: 0,
    scale: 1,
  },
  float: {
    rotateX: [-2, 2, -2],
    rotateY: [-3, 3, -3],
    z: [0, 8, 0],
    scale: [1, 1.02, 1],
    transition: {
      duration: 4,
      repeat: Infinity,
      ease: "easeInOut",
    },
  },
};

/** Cards — tilt no hover/tap (benefícios, hub). */
export const cardTiltVariants: Variants = {
  rest: {
    rotateX: 0,
    rotateY: 0,
    z: 0,
    scale: 1,
  },
  hover: {
    rotateX: -4,
    rotateY: 6,
    z: 12,
    scale: 1.01,
    transition: clinical3DSpring,
  },
  tap: {
    rotateX: 0,
    rotateY: 0,
    z: 4,
    scale: 0.99,
    transition: { duration: 0.12 },
  },
};

/** Cards — flip frente/verso (antes-depois). */
export const cardFlipVariants: Variants = {
  front: {
    rotateY: 0,
    opacity: 1,
    transition: clinical3DPanelTransition,
  },
  back: {
    rotateY: 180,
    opacity: 0,
    transition: clinical3DPanelTransition,
  },
};

/** CTAs — profundidade no hover/tap (landing CTA, planos). */
export const ctaDepthVariants: Variants = {
  idle: { z: 0, scale: 1 },
  hover: {
    z: 16,
    scale: 1.02,
    transition: clinical3DSpring,
  },
  tap: {
    z: 4,
    scale: 0.98,
    transition: { duration: 0.1 },
  },
};

/** Galeria funcionalidades — entrada com rotateX leve. */
export const featureCard3DVariants: Variants = {
  hidden: { opacity: 0, y: 20, rotateX: 10, z: -20 },
  visible: {
    opacity: 1,
    y: 0,
    rotateX: 0,
    z: 0,
    transition: clinical3DPanelTransition,
  },
};

export type LandingPanel3DState = "active" | "inactive" | "peekPrev" | "peekNext";

/** Deriva estado 3D do painel a partir dos índices. */
export function getLandingPanel3DState(
  panelIndex: number,
  activeIndex: number,
): LandingPanel3DState {
  const delta = panelIndex - activeIndex;
  if (delta === 0) return "active";
  if (delta === -1) return "peekPrev";
  if (delta === 1) return "peekNext";
  return "inactive";
}
