"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import {
  searchPatientsForEvolution,
  type EvolutionPatientSearchHit,
} from "@/app/actions/patient";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = {
  disabled?: boolean;
  busy?: boolean;
  onSelect: (hit: EvolutionPatientSearchHit) => void | Promise<void>;
};

export function EvolveExistingPatientSearch({
  disabled,
  busy,
  onSelect,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<EvolutionPatientSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setHits([]);
      setError(null);
      setSearching(false);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      setSearching(true);
      void searchPatientsForEvolution(trimmed).then((res) => {
        if (cancelled) return;
        setSearching(false);
        if (!res.success) {
          setHits([]);
          setError(res.error);
          return;
        }
        setError(null);
        setHits(res.patients);
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [open, query]);

  return (
    <div ref={rootRef} className="relative w-full sm:w-auto">
      <button
        type="button"
        disabled={disabled || busy}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-primary bg-card px-4 py-2 text-center text-sm font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 sm:w-auto"
      >
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
        Evoluir paciente já cadastrado
      </button>

      {open ? (
        <div className="absolute left-0 right-0 z-20 mt-2 w-full min-w-[18rem] rounded-xl border border-border bg-card p-3 text-left shadow-[var(--shadow-elevation-2)] sm:right-auto sm:w-[22rem]">
          <label htmlFor={`${listId}-query`} className="sr-only">
            Nome do paciente
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id={`${listId}-query`}
              value={query}
              autoFocus
              placeholder="Nome do paciente"
              className="min-h-11 pl-9"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div id={listId} role="listbox" aria-label="Pacientes encontrados" className="mt-2 max-h-64 overflow-y-auto">
            {searching ? (
              <p className="flex items-center gap-2 px-1 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Buscando…
              </p>
            ) : null}
            {!searching && error ? (
              <p className="px-1 py-3 text-sm text-destructive">{error}</p>
            ) : null}
            {!searching && !error && query.trim().length < 2 ? (
              <p className="px-1 py-3 text-sm text-muted-foreground">
                Digite pelo menos 2 letras do nome.
              </p>
            ) : null}
            {!searching && !error && query.trim().length >= 2 && hits.length === 0 ? (
              <p className="px-1 py-3 text-sm text-muted-foreground">Nenhum paciente com esse nome.</p>
            ) : null}
            {hits.map((hit) => (
              <button
                key={hit.id}
                type="button"
                role="option"
                className={cn(
                  "flex min-h-11 w-full flex-col items-start rounded-lg px-2 py-2 text-left hover:bg-muted",
                )}
                onClick={() => {
                  setOpen(false);
                  void onSelect(hit);
                }}
              >
                <span className="text-sm font-medium text-foreground">
                  {hit.name}
                  {hit.ageLabel ? ` · ${hit.ageLabel}` : ""}
                </span>
                <span className="text-xs text-muted-foreground">
                  {hit.lastEvolutionLabel
                    ? `Última evolução em ${hit.lastEvolutionLabel}`
                    : "Sem evolução anterior"}
                  {hit.diagnosis ? ` · ${hit.diagnosis}` : ""}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
