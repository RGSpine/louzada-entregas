"use client";

import { useEffect } from "react";
import { useTheme } from "@/components/theme/ClinicalThemeProvider";
import { applyThemeClass } from "@/lib/clinical-theme";
import type { ClinicalCalmThemeMode } from "@/design/tokens";

/** Sincroniza tema auto (horário clínico BRT) e system com a classe .dark */
export function ClinicalThemeSync() {
  const { theme } = useTheme();

  useEffect(() => {
    const stored = theme as ClinicalCalmThemeMode | undefined;
    if (!stored) return;

    const sync = () => {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      applyThemeClass(stored, prefersDark);
    };

    sync();

    if (stored !== "auto" && stored !== "system") return;

    const interval = stored === "auto" ? window.setInterval(sync, 60_000) : undefined;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onMq = () => sync();
    mq.addEventListener("change", onMq);

    return () => {
      if (interval) clearInterval(interval);
      mq.removeEventListener("change", onMq);
    };
  }, [theme]);

  return null;
}
