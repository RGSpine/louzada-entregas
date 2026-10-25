"use client";

import { useEffect, useState } from "react";
import { PanelLeft, PanelLeftClose, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDashboardSidebar } from "@/components/dashboard/DashboardSidebarProvider";

type Props = {
  className?: string;
  /** Botão compacto só com ícone (ex.: barra superior). */
  compact?: boolean;
};

/**
 * Controle Clinical Calm — fixar menu lateral ou usar modo sob demanda (desktop).
 * Em &lt;lg abre sempre o overlay (sidebar docked fica `hidden` no mobile).
 */
export function DashboardSidebarToggle({ className, compact = false }: Props) {
  const { mounted, pinned, isVisible, setPinned, openOverlay } = useDashboardSidebar();
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  if (!mounted) {
    return (
      <div
        className={cn(
          "rounded-lg border border-border bg-muted shadow-[var(--shadow-elevation-1)]",
          compact ? "size-9" : "h-9 w-[7.5rem]",
          className,
        )}
        aria-hidden
      />
    );
  }

  // Mobile/tablet: docked sidebar não aparece — abrir overlay.
  if (!isDesktop) {
    return (
      <Button
        type="button"
        variant="outline"
        size={compact ? "icon" : "sm"}
        onClick={() => {
          if (pinned) setPinned(false);
          openOverlay();
        }}
        className={cn(
          "border-border text-foreground shadow-[var(--shadow-elevation-1)]",
          "hover:bg-muted hover:text-foreground",
          !compact && "min-w-[8.5rem]",
          className,
        )}
        aria-label="Abrir menu lateral"
        title="Abrir menu"
      >
        <Menu className="h-4 w-4 shrink-0" aria-hidden />
        {!compact ? <span>Abrir menu</span> : null}
      </Button>
    );
  }

  if (pinned) {
    return (
      <Button
        type="button"
        variant="outline"
        size={compact ? "icon" : "sm"}
        onClick={() => setPinned(false)}
        className={cn(
          "border-primary/25 bg-primary/10 text-primary shadow-[var(--shadow-elevation-1)] hover:bg-primary/15",
          !compact && "min-w-[8.5rem]",
          className,
        )}
        aria-pressed={true}
        aria-label="Menu lateral fixo — clique para ocultar por padrão"
        title="Menu fixo ativo"
      >
        <PanelLeftClose className="h-4 w-4 shrink-0" aria-hidden />
        {!compact ? <span>Menu fixo</span> : null}
      </Button>
    );
  }

  if (!isVisible) {
    return (
      <Button
        type="button"
        variant="outline"
        size={compact ? "icon" : "sm"}
        onClick={openOverlay}
        className={cn(
          "border-border text-foreground shadow-[var(--shadow-elevation-1)]",
          "hover:bg-muted hover:text-foreground",
          !compact && "min-w-[8.5rem]",
          className,
        )}
        aria-pressed={false}
        aria-label="Abrir menu lateral"
        title="Abrir menu"
      >
        <Menu className="h-4 w-4 shrink-0" aria-hidden />
        {!compact ? <span>Abrir menu</span> : null}
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size={compact ? "icon" : "sm"}
      onClick={() => setPinned(true)}
      className={cn(
        "border-border text-foreground shadow-[var(--shadow-elevation-1)]",
        "hover:bg-muted hover:text-foreground",
        !compact && "min-w-[8.5rem]",
        className,
      )}
      aria-pressed={false}
      aria-label="Fixar menu lateral sempre visível"
      title="Fixar menu lateral"
    >
      <PanelLeft className="h-4 w-4 shrink-0" aria-hidden />
      {!compact ? <span>Fixar menu</span> : null}
    </Button>
  );
}
