"use client";

import { MessageCircle, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CARD_ENTITY_NAME_CLASS } from "@/lib/card-entity-name";
import type { ClinicalChatPatientItem } from "@/app/actions/clinical-chat";

type PatientChatSidebarProps = {
  patients: ClinicalChatPatientItem[];
  selectedPatientId: string | null;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSelectPatient: (id: string) => void;
  loading?: boolean;
  className?: string;
  onClose?: () => void;
};

function patientInitial(name: string): string {
  const t = name.trim();
  return t ? t[0]!.toUpperCase() : "?";
}

export function PatientChatSidebar({
  patients,
  selectedPatientId,
  searchQuery,
  onSearchChange,
  onSelectPatient,
  loading = false,
  className,
  onClose,
}: PatientChatSidebarProps) {
  const q = searchQuery.trim().toLowerCase();
  const filtered = q
    ? patients.filter((p) => p.name.toLowerCase().includes(q))
    : patients;

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-full shrink-0 flex-col border-r border-border/90 bg-muted/50 dark:border-border dark:bg-card/50 md:w-72 lg:w-80",
        className,
      )}
    >
      <div className="border-b border-border/90 bg-card/60 p-3.5 backdrop-blur-sm dark:border-border dark:bg-card/60">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <MessageCircle className="h-4 w-4 shrink-0 text-clinical" aria-hidden />
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground dark:text-muted-foreground">
              Pacientes evoluídos
            </p>
          </div>
          {onClose ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 md:hidden"
              onClick={onClose}
              aria-label="Fechar lista de pacientes"
            >
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="Buscar paciente…"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="border-border/80 bg-white pl-9 shadow-sm dark:border-border dark:bg-background"
            aria-label="Buscar paciente"
          />
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-2.5" aria-label="Lista de pacientes">
        {loading ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">Carregando…</p>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">
            {q ? "Nenhum paciente encontrado." : "Nenhum paciente com evoluções."}
          </p>
        ) : (
          <ul className="space-y-1">
            {filtered.map((p) => {
              const active = p.id === selectedPatientId;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onSelectPatient(p.id)}
                    className={cn(
                      "flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2.5 text-left text-sm transition-all",
                      active
                        ? "border border-clinical/30 bg-card font-medium text-foreground shadow-[var(--shadow-elevation-1)] dark:border-clinical/40 dark:bg-clinical/15"
                        : "border border-transparent text-foreground/90 hover:bg-card/80 dark:hover:bg-muted/60",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                        active
                          ? "bg-clinical text-white"
                          : "bg-muted text-muted-foreground dark:bg-muted dark:text-foreground",
                      )}
                      aria-hidden
                    >
                      {patientInitial(p.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block", CARD_ENTITY_NAME_CLASS)}>{p.name}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {p.evolutionCount}{" "}
                        {p.evolutionCount === 1 ? "evolução" : "evoluções"}
                      </span>
                    </span>
                    {active ? (
                      <span
                        className="h-8 w-1 shrink-0 rounded-full bg-clinical"
                        aria-hidden
                      />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
    </aside>
  );
}
