"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  listServiceSpaces,
  type ServiceSpaceRow,
} from "@/app/actions/service-spaces";

const STORAGE_KEY = "aievolui_finance_space_view";

export type SpaceViewValue = "all" | string;

type Props = {
  /** Chamado quando o utilizador muda a visão (all | spaceId). */
  onChange: (view: SpaceViewValue) => void;
  className?: string;
  /** Chave localStorage (default: financeiro). Agenda usa outra para não misturar. */
  storageKey?: string;
  /** Rótulo à esquerda dos chips. */
  label?: string;
};

/**
 * Seletor Todos / Espaço (Consultório Financeiro ou Agenda).
 * Só renderiza se o plano tiver Espaços activos.
 */
export function FinanceSpaceSwitcher({
  onChange,
  className,
  storageKey = STORAGE_KEY,
  label = "Espaço",
}: Props) {
  const [enabled, setEnabled] = useState(false);
  const [spaces, setSpaces] = useState<ServiceSpaceRow[]>([]);
  const [view, setView] = useState<SpaceViewValue>("all");
  const [loading, setLoading] = useState(true);

  const apply = useCallback(
    (next: SpaceViewValue) => {
      setView(next);
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        /* ignore */
      }
      onChange(next);
    },
    [onChange, storageKey],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const res = await listServiceSpaces();
      if (cancelled) return;
      if (!res.success) {
        setLoading(false);
        return;
      }
      setEnabled(res.data.enabled);
      setSpaces(res.data.spaces);
      setLoading(false);
      if (!res.data.enabled) {
        onChange("all");
        return;
      }
      let initial: SpaceViewValue = "all";
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored === "all" || res.data.spaces.some((s) => s.id === stored)) {
          initial = stored as SpaceViewValue;
        }
      } catch {
        /* ignore */
      }
      setView(initial);
      onChange(initial);
    })();
    return () => {
      cancelled = true;
    };
  }, [onChange, storageKey]);

  if (loading || !enabled) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <Button
        type="button"
        size="sm"
        variant={view === "all" ? "default" : "outline"}
        className={cn(
          "h-8 rounded-full",
          view === "all" && "bg-clinical text-clinical-foreground hover:bg-clinical/90",
        )}
        onClick={() => apply("all")}
      >
        Todos
      </Button>
      {spaces.map((s) => (
        <Button
          key={s.id}
          type="button"
          size="sm"
          variant={view === s.id ? "default" : "outline"}
          className="h-8 gap-1.5 rounded-full"
          style={
            view === s.id
              ? { backgroundColor: s.color, borderColor: s.color, color: "#fff" }
              : undefined
          }
          onClick={() => apply(s.id)}
        >
          <span
            className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-black/10"
            style={{ backgroundColor: s.color }}
            aria-hidden
          />
          {s.name}
        </Button>
      ))}
      {spaces.length === 0 && (
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() =>
            toast.info("Crie o primeiro espaço em Configurar → Espaços de Serviços.")
          }
        >
          Nenhum espaço ainda
        </button>
      )}
    </div>
  );
}
