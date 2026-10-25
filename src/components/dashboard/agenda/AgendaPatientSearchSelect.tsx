"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type AgendaPatientOption = { id: string; name: string };

type Props = {
  patients: AgendaPatientOption[];
  value: string;
  onChange: (patientId: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
};

function sortPatientsPt(patients: AgendaPatientOption[]): AgendaPatientOption[] {
  return [...patients].sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }),
  );
}

function normalizeSearch(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/**
 * Seletor de paciente com ordem alfabética (pt-BR) e busca por nome.
 * Evita o `<select>` nativo com lista longa sem filtro.
 */
export function AgendaPatientSearchSelect({
  patients,
  value,
  onChange,
  placeholder = "Buscar paciente…",
  disabled = false,
  id,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const sorted = useMemo(() => sortPatientsPt(patients), [patients]);
  const selected = sorted.find((p) => p.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = normalizeSearch(query);
    if (!q) return sorted;
    return sorted.filter((p) => normalizeSearch(p.name).includes(q));
  }, [sorted, query]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  function selectPatient(id: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => !prev);
        }}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-left text-sm outline-none",
          "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          !selected && "text-muted-foreground",
        )}
      >
        <span className="min-w-0 truncate">
          {selected?.name ?? "Selecione o paciente"}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden />
      </button>

      {open ? (
        <div
          className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-md border border-border bg-card shadow-[var(--shadow-elevation-2)]"
          role="listbox"
          aria-label="Lista de pacientes"
        >
          <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
              autoComplete="off"
              aria-label="Buscar paciente pelo nome"
            />
          </div>
          <ul className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted-foreground">
                Nenhum paciente encontrado.
              </li>
            ) : (
              filtered.map((p) => {
                const isSelected = p.id === value;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60",
                        isSelected && "bg-muted/40 font-medium",
                      )}
                      onClick={() => selectPatient(p.id)}
                    >
                      <Check
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          isSelected ? "opacity-100" : "opacity-0",
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 truncate">{p.name}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
