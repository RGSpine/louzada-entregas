"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { applyThemeClass, readStoredTheme, THEME_STORAGE_KEY } from "@/lib/clinical-theme";
import { resolveClinicalDark, type ClinicalCalmThemeMode } from "@/design/tokens";

function isStoredTheme(value: string): value is ClinicalCalmThemeMode {
  return value === "auto" || value === "light" || value === "dark" || value === "system";
}

type ThemeContextValue = {
  theme: string | undefined;
  setTheme: (theme: string) => void;
  resolvedTheme: "light" | "dark" | undefined;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: undefined,
  setTheme: () => {},
  resolvedTheme: undefined,
});

/**
 * Tema sem <script> na árvore do React. A classe no <html> entra antes
 * da pintura pelo ClinicalThemeBootstrap.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ClinicalCalmThemeMode | undefined>(undefined);
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark" | undefined>(undefined);

  const apply = useCallback((mode: ClinicalCalmThemeMode) => {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyThemeClass(mode, prefersDark);
    setResolvedTheme(resolveClinicalDark(mode, prefersDark) ? "dark" : "light");
  }, []);

  useEffect(() => {
    const stored = readStoredTheme();
    setThemeState(stored);
    apply(stored);
  }, [apply]);

  useEffect(() => {
    if (!theme || (theme !== "auto" && theme !== "system")) return;
    const sync = () => apply(theme);
    const interval = theme === "auto" ? window.setInterval(sync, 60_000) : undefined;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", sync);
    return () => {
      if (interval) window.clearInterval(interval);
      mq.removeEventListener("change", sync);
    };
  }, [theme, apply]);

  const setTheme = useCallback(
    (next: string) => {
      const mode: ClinicalCalmThemeMode = isStoredTheme(next) ? next : "auto";
      setThemeState(mode);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, mode);
      } catch {
        /* ignore */
      }
      apply(mode);
    },
    [apply],
  );

  const value = useMemo(
    () => ({ theme, setTheme, resolvedTheme }),
    [theme, setTheme, resolvedTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
