/**
 * Louzada — tokens JS (web).
 * A tinta vem da logo: CMYK 100/100/25/25 → #00008f.
 */

export const clinicalCalmColors = {
  light: {
    background: "#e7eef8",
    foreground: "#12163a",
    card: "#ffffff",
    primary: "#00008f",
    primaryForeground: "#ffffff",
    secondary: "#d9e3f2",
    accent: "#00008f",
    muted: "#e3ebf6",
    mutedForeground: "#526084",
    border: "#d3deee",
    success: "#047857",
    warning: "#b45309",
    destructive: "#dc2626",
    clinical: "#00008f",
    entrega: "#00008f",
    coleta: "#b45309",
  },
  dark: {
    background: "#0c1224",
    foreground: "#eef0ff",
    card: "#171e36",
    primary: "#b9baff",
    primaryForeground: "#0c0d3a",
    secondary: "#222a44",
    accent: "#b9baff",
    muted: "#1a2238",
    mutedForeground: "#a8b0d0",
    border: "#2a3454",
    success: "#34d399",
    warning: "#fdba74",
    destructive: "#f87171",
    clinical: "#b9baff",
    entrega: "#b9baff",
    coleta: "#fdba74",
  },
} as const;

export const clinicalCalmRadius = {
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

export const clinicalCalmTouch = {
  minSizePx: 44,
} as const;

export type ClinicalCalmThemeMode = "light" | "dark" | "system" | "auto";

/** Horário clínico BRT: light 7h–19h */
export function isClinicalDaylightHour(date = new Date()): boolean {
  const hour = Number(
    date.toLocaleString("en-US", {
      timeZone: "America/Sao_Paulo",
      hour: "numeric",
      hour12: false,
    }),
  );
  return hour >= 7 && hour < 19;
}

export function resolveClinicalDark(
  theme: ClinicalCalmThemeMode,
  prefersDark: boolean,
): boolean {
  if (theme === "light") return false;
  if (theme === "dark") return true;
  if (theme === "auto") return !isClinicalDaylightHour();
  return prefersDark;
}
