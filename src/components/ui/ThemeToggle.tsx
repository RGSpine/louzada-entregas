"use client";

import { useTheme } from "@/components/theme/ClinicalThemeProvider";
import { Sun, Moon, Monitor, Clock, Type } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { ClinicalCalmThemeMode } from "@/design/tokens";

const LEGIBILITY_KEY = "clinical-legibility";

const MODES: {
  value: ClinicalCalmThemeMode;
  label: string;
  icon: typeof Sun;
}[] = [
  { value: "auto", label: "Automático (consultório 7h–19h)", icon: Clock },
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Escuro", icon: Moon },
  { value: "system", label: "Sistema", icon: Monitor },
];

/**
 * Seletor de tema Clinical Calm — auto (horário clínico), claro, escuro, sistema.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [highLegibility, setHighLegibility] = useState(false);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setMounted(true));
    try {
      setHighLegibility(localStorage.getItem(LEGIBILITY_KEY) === "high");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const sync = () =>
      setIsDark(document.documentElement.classList.contains("dark"));
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => obs.disconnect();
  }, [mounted, theme]);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.dataset.legibility = highLegibility ? "high" : "normal";
  }, [mounted, highLegibility]);

  if (!mounted) {
    // Mesma árvore do botão real — evita mismatch de hidratação (div vs button).
    return (
      <button
        type="button"
        disabled
        aria-hidden
        tabIndex={-1}
        className={cn(
          "flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-2",
          "shadow-[var(--shadow-elevation-1)] opacity-0",
        )}
      />
    );
  }

  const current = (theme ?? "auto") as ClinicalCalmThemeMode;
  const activeMode = MODES.find((m) => m.value === current) ?? MODES[0];
  const ActiveIcon = activeMode.icon;

  const toggleLegibility = () => {
    const next = !highLegibility;
    setHighLegibility(next);
    document.documentElement.dataset.legibility = next ? "high" : "normal";
    try {
      localStorage.setItem(LEGIBILITY_KEY, next ? "high" : "normal");
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-2",
          "shadow-[var(--shadow-elevation-1)] transition-[box-shadow,transform] hover:shadow-[var(--shadow-elevation-2)]",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "active:scale-[0.98]",
          className,
        )}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Tema: ${activeMode.label}. ${isDark ? "Modo escuro ativo" : "Modo claro ativo"}`}
        title={activeMode.label}
      >
        <ActiveIcon className="h-4 w-4 shrink-0 text-foreground" aria-hidden />
      </button>

      {open ? (
        <>
          <div
            className="fixed inset-0 z-40"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <ul
            role="listbox"
            aria-label="Selecionar tema"
            className={cn(
              "absolute right-0 top-full z-50 mt-2 min-w-[14rem] rounded-xl border border-border bg-popover p-1",
              "shadow-[var(--shadow-elevation-3)]",
            )}
          >
            {MODES.map(({ value, label, icon: Icon }) => {
              const selected = current === value;
              return (
                <li key={value} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => {
                      setTheme(value);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full min-h-[2.75rem] items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                      selected
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-foreground hover:bg-muted",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    {label}
                  </button>
                </li>
              );
            })}
            <li className="mt-1 border-t border-border pt-1">
              <button
                type="button"
                onClick={toggleLegibility}
                className={cn(
                  "flex w-full min-h-[2.75rem] items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                  highLegibility
                    ? "bg-accent/10 font-medium text-accent"
                    : "text-foreground hover:bg-muted",
                )}
              >
                <Type className="h-4 w-4 shrink-0" aria-hidden />
                Alta legibilidade
              </button>
            </li>
          </ul>
        </>
      ) : null}
    </div>
  );
}
