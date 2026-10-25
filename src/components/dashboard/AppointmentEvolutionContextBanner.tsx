"use client";

import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  slotLabel: string;
  patientName: string;
  className?: string;
};

export function AppointmentEvolutionContextBanner({
  slotLabel,
  patientName,
  className,
}: Props) {
  return (
    <div
      className={cn(
        "mb-6 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 dark:border-primary/30 dark:bg-primary/15",
        className,
      )}
      role="status"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-primary dark:text-primary">
            <CalendarDays className="h-4 w-4 shrink-0" aria-hidden />
            Marcação: {slotLabel}
          </p>
          <p className="mt-1 text-sm text-primary/90 dark:text-primary/90">
            Paciente: <span className="font-medium">{patientName}</span>
          </p>
          <p className="mt-1 text-xs text-primary/80 dark:text-primary/80">
            A evolução será vinculada a este horário na agenda.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 border-primary/50 bg-white/80 text-primary hover:bg-card dark:border-primary/40 dark:bg-card/60 dark:text-primary"
          asChild
        >
          <Link href="/dashboard/agenda">Voltar à agenda</Link>
        </Button>
      </div>
    </div>
  );
}
