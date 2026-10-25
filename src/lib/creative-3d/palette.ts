import type { JarvisPalette, JarvisVisualState } from "@/components/creative-3d/types";

/** Paleta Clinical Calm para WebGL (hex → uniformes Three). */
export const JARVIS_PALETTE_DEFAULT: JarvisPalette = {
  core: "#0d9488",
  glow: "#2563eb",
  accent: "#14b8a6",
};

const STATE_INTENSITY: Record<JarvisVisualState, number> = {
  idle: 0.28,
  hover: 0.38,
  active: 0.52,
  listening: 0.72,
  processing: 0.85,
  success: 0.45,
  error: 0.55,
  disabled: 0.12,
};

const STATE_ACTIVE: Record<JarvisVisualState, number> = {
  idle: 0,
  hover: 0.25,
  active: 0.55,
  listening: 0.85,
  processing: 1,
  success: 0.4,
  error: 0.65,
  disabled: 0,
};

export function jarvisStateUniforms(state: JarvisVisualState): {
  intensity: number;
  active: number;
} {
  return {
    intensity: STATE_INTENSITY[state],
    active: STATE_ACTIVE[state],
  };
}
