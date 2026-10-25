/** Fundos da página "Plataforma com a sua cara" — desktop (paisagem) e mobile (retrato). */
export const PLATFORM_CUSTOMIZATION_BG = {
  desktop: "/images/platform-customization/platform-customization-bg-desktop.jpg",
  mobile: "/images/platform-customization/platform-customization-bg-mobile.jpg",
} as const;

/** Card funcional com glassmorphism / Spatial UI sobre a foto de fundo. */
export const platformCustomizationGlassCardClass =
  "overflow-hidden rounded-2xl border border-white/50 bg-white/70 shadow-[var(--shadow-elevation-3)] ring-1 ring-white/25 backdrop-blur-2xl backdrop-saturate-150 dark:border-white/15 dark:bg-card/55 dark:ring-white/10";

export const platformCustomizationGlassFieldClass =
  "border-white/55 bg-white/85 shadow-sm backdrop-blur-sm dark:border-white/15 dark:bg-background/75";

export const platformCustomizationGlassHeaderClass =
  "border-white/30 bg-white/35 backdrop-blur-xl dark:border-white/10 dark:bg-background/40";
