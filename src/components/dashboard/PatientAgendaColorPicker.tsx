"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { updatePatientAgendaColor } from "@/app/actions/patient";
import {
  PATIENT_AGENDA_COLOR_PALETTE,
  resolvePatientAgendaColor,
} from "@/lib/patient-agenda-color";
import { cn } from "@/lib/utils";

type Props = {
  patientId: string;
  agendaColor: string | null;
  resolvedAgendaColor: string;
  onUpdated?: (resolved: string, stored: string | null) => void;
};

export function PatientAgendaColorPicker({
  patientId,
  agendaColor,
  resolvedAgendaColor,
  onUpdated,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [stored, setStored] = useState<string | null>(agendaColor);
  const [resolved, setResolved] = useState(resolvedAgendaColor);

  async function pick(color: string | null) {
    setBusy(true);
    try {
      const res = await updatePatientAgendaColor(patientId, color);
      if (!res.success) {
        toast.error(res.error ?? "Não foi possível salvar a cor.");
        return;
      }
      setStored(color);
      const nextResolved = res.resolvedAgendaColor ?? resolvePatientAgendaColor(patientId, color);
      setResolved(nextResolved);
      onUpdated?.(nextResolved, color);
      toast.success(color ? "Cor da agenda atualizada." : "Cor automática restaurada.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">Cor na agenda</Label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          title="Automática (estável por paciente)"
          aria-label="Cor automática na agenda"
          onClick={() => void pick(null)}
          className={cn(
            "h-7 rounded-md border px-2 text-xs font-medium transition-colors",
            stored == null
              ? "border-foreground bg-muted text-foreground dark:border-border dark:bg-muted dark:text-foreground"
              : "border-border text-muted-foreground hover:bg-muted dark:border-border dark:text-muted-foreground",
          )}
        >
          Auto
        </button>
        {PATIENT_AGENDA_COLOR_PALETTE.map((color) => (
          <button
            key={color}
            type="button"
            disabled={busy}
            title={color}
            aria-label={`Cor ${color}`}
            onClick={() => void pick(color)}
            className={cn(
              "h-7 w-7 rounded-full border-2 transition-transform hover:scale-105",
              stored === color ? "border-foreground dark:border-white ring-2 ring-offset-1" : "border-transparent",
            )}
            style={{ backgroundColor: color }}
          />
        ))}
        <span
          className="ml-1 inline-flex h-7 items-center rounded-md border border-border px-2 text-xs text-muted-foreground dark:border-border dark:text-muted-foreground"
          style={{ boxShadow: `inset 3px 0 0 0 ${resolved}` }}
        >
          Pré-visualização
        </span>
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        Barra colorida identifica o paciente. Amarelo/verde do card continuam a indicar confirmação de presença.
      </p>
    </div>
  );
}
