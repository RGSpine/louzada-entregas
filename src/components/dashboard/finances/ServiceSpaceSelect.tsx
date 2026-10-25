"use client";

import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  listServiceSpaces,
  type ServiceSpaceRow,
} from "@/app/actions/service-spaces";

type Props = {
  value: string;
  onChange: (spaceId: string) => void;
  /** Inclui opção «Geral (todos)». Default true. */
  allowGeneral?: boolean;
  label?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
  /** Se o plano não tem espaços, não renderiza. */
  onEnabledChange?: (enabled: boolean) => void;
};

/**
 * Select de Espaço de Serviços (Consultório/Clínica).
 * Se o plano não tiver a feature ou não houver espaços, devolve null.
 */
export function ServiceSpaceSelect({
  value,
  onChange,
  allowGeneral = true,
  label = "Espaço de Serviços",
  id = "service-space",
  className,
  disabled,
  onEnabledChange,
}: Props) {
  const [enabled, setEnabled] = useState(false);
  const [spaces, setSpaces] = useState<ServiceSpaceRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    void listServiceSpaces().then((res) => {
      if (cancelled) return;
      if (!res.success || !res.data.enabled) {
        setEnabled(false);
        setSpaces([]);
        onEnabledChange?.(false);
        return;
      }
      setEnabled(true);
      setSpaces(res.data.spaces);
      onEnabledChange?.(true);
    });
    return () => {
      cancelled = true;
    };
  }, [onEnabledChange]);

  if (!enabled || spaces.length === 0) return null;

  const selected = spaces.find((s) => s.id === value);

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        {selected && (
          <span
            className="h-3 w-3 shrink-0 rounded-full ring-1 ring-black/10"
            style={{ backgroundColor: selected.color }}
            aria-hidden
          />
        )}
        <select
          id={id}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          {allowGeneral && <option value="">Geral (todos os espaços)</option>}
          {spaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export type { ServiceSpaceRow };
