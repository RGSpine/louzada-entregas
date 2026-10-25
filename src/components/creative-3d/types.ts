/** Estados visuais do núcleo Jarvis (botões / indicadores de IA). */
export type JarvisVisualState =
  | "idle"
  | "hover"
  | "active"
  | "listening"
  | "processing"
  | "success"
  | "error"
  | "disabled";

export type Creative3dTier = "webgl" | "fallback";

export type Creative3dCapability = {
  tier: Creative3dTier;
  /** Motivo quando cai em fallback (debug / telemetria opcional). */
  reason?: string;
  reducedMotion: boolean;
  prefersLowPower: boolean;
};

export type JarvisPalette = {
  core: string;
  glow: string;
  accent: string;
};

export type JarvisOrbMeshProps = {
  state: JarvisVisualState;
  intensity?: number;
  palette?: Partial<JarvisPalette>;
};

export type JarvisOrbButtonProps = {
  state?: JarvisVisualState;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  size?: number;
  "aria-label": string;
  "aria-pressed"?: boolean;
};
