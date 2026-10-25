"use client";

import { Clock, Loader2 } from "lucide-react";
import { DateTime } from "luxon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AgendaAppointmentMetaFields,
  type AppointmentMetaFormState,
} from "@/components/dashboard/AgendaAppointmentMetaFields";
import {
  AgendaRecurrenceFields,
  type AgendaRecurrenceFormState,
} from "@/components/dashboard/agenda/AgendaRecurrenceFields";
import { cn } from "@/lib/utils";
import { agendaTopOutlineBtnClass } from "@/components/dashboard/agenda-card-actions";
import { DEFAULT_SCHEDULE_TIMEZONE } from "@/lib/schedule-temporal-parse";
import { shiftTimeValue, snapTimeValue } from "@/lib/agenda/agenda-time-edit";
import { AgendaPatientSearchSelect } from "@/components/dashboard/agenda/AgendaPatientSearchSelect";

export type PatientOption = { id: string; name: string };

type Props = {
  patients: PatientOption[];
  patientPickMode: "existing" | "new";
  onPatientPickModeChange: (mode: "existing" | "new") => void;
  patientId: string;
  onPatientIdChange: (id: string) => void;
  newPatientName: string;
  onNewPatientNameChange: (name: string) => void;
  title: string;
  onTitleChange: (title: string) => void;
  dateValue: string;
  onDateValueChange: (date: string) => void;
  timeValue: string;
  onTimeValueChange: (time: string) => void;
  durationMinutes: string;
  onDurationMinutesChange: (minutes: string) => void;
  dateExpression: string;
  onDateExpressionChange: (expr: string) => void;
  onResolveExpression: () => void;
  appointmentMeta: AppointmentMetaFormState;
  onAppointmentMetaChange: (patch: Partial<AppointmentMetaFormState>) => void;
  recurrence: AgendaRecurrenceFormState;
  onRecurrenceChange: (patch: Partial<AgendaRecurrenceFormState>) => void;
  submitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
  slotHint?: string | null;
};

export function AgendaManualBookingForm({
  patients,
  patientPickMode,
  onPatientPickModeChange,
  patientId,
  onPatientIdChange,
  newPatientName,
  onNewPatientNameChange,
  title,
  onTitleChange,
  dateValue,
  onDateValueChange,
  timeValue,
  onTimeValueChange,
  durationMinutes,
  onDurationMinutesChange,
  dateExpression,
  onDateExpressionChange,
  onResolveExpression,
  appointmentMeta,
  onAppointmentMetaChange,
  recurrence,
  onRecurrenceChange,
  submitting,
  onSubmit,
  slotHint,
}: Props) {
  const outlineBtn = agendaTopOutlineBtnClass;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {slotHint ? (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-foreground">
          <p>{slotHint}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            O horário abaixo é editável — use os botões ou digite outro valor.
          </p>
        </div>
      ) : null}

      <div className="space-y-3 rounded-md border border-border/80 bg-muted/30 p-3">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h3 className="text-sm font-semibold">Data e horário</h3>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="manual-date">Data</Label>
            <Input
              id="manual-date"
              type="date"
              value={dateValue}
              onChange={(e) => {
                onDateValueChange(e.target.value);
                const dt = DateTime.fromISO(e.target.value, { zone: DEFAULT_SCHEDULE_TIMEZONE });
                if (dt.isValid && !recurrence.enabled) {
                  onRecurrenceChange({ weekdays: [dt.weekday] });
                }
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-time">Horário</Label>
            <Input
              id="manual-time"
              type="time"
              step={300}
              value={timeValue}
              onChange={(e) => onTimeValueChange(e.target.value)}
              onBlur={() => onTimeValueChange(snapTimeValue(timeValue, 5))}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn("h-8 text-xs", outlineBtn)}
            onClick={() => onTimeValueChange(shiftTimeValue(timeValue, -15))}
          >
            −15 min
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn("h-8 text-xs", outlineBtn)}
            onClick={() => onTimeValueChange(shiftTimeValue(timeValue, -5))}
          >
            −5 min
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn("h-8 text-xs", outlineBtn)}
            onClick={() => onTimeValueChange(snapTimeValue(timeValue, 15))}
          >
            Ajustar :00/:15/:30/:45
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn("h-8 text-xs", outlineBtn)}
            onClick={() => onTimeValueChange(shiftTimeValue(timeValue, 5))}
          >
            +5 min
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn("h-8 text-xs", outlineBtn)}
            onClick={() => onTimeValueChange(shiftTimeValue(timeValue, 15))}
          >
            +15 min
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <Label>Paciente ou compromisso</Label>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={patientPickMode === "existing" ? "default" : "outline"}
            className={cn(
              patientPickMode === "existing"
                ? "bg-primary hover:bg-primary/90"
                : outlineBtn,
              "!h-auto min-h-9",
            )}
            onClick={() => onPatientPickModeChange("existing")}
          >
            Paciente já atendido
          </Button>
          <Button
            type="button"
            variant={patientPickMode === "new" ? "default" : "outline"}
            className={cn(
              patientPickMode === "new" ? "bg-primary hover:bg-primary/90" : outlineBtn,
              "!h-auto min-h-9",
            )}
            onClick={() => onPatientPickModeChange("new")}
          >
            Compromisso / nome livre
          </Button>
        </div>
        {patientPickMode === "existing" ? (
          <AgendaPatientSearchSelect
            patients={patients}
            value={patientId}
            onChange={onPatientIdChange}
            placeholder="Digite o nome para buscar…"
          />
        ) : (
          <div className="space-y-1">
            <Input
              value={newPatientName}
              onChange={(e) => onNewPatientNameChange(e.target.value)}
              placeholder="Ex.: Reunião, Almoço, João (ainda sem ficha)"
              maxLength={200}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Só aparece na agenda. Ficha de paciente clínico é criada apenas ao salvar uma evolução.
            </p>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="manual-title">Título (opcional)</Label>
        <Input
          id="manual-title"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Acompanhamento específico"
        />
      </div>

      <AgendaAppointmentMetaFields
        state={appointmentMeta}
        onChange={onAppointmentMetaChange}
        patientId={patientPickMode === "existing" ? patientId : ""}
      />

      <div className="space-y-2">
        <Label htmlFor="dateExpression">Expressão temporal (opcional)</Label>
        <div className="flex gap-2">
          <Input
            id="dateExpression"
            value={dateExpression}
            onChange={(e) => onDateExpressionChange(e.target.value)}
            placeholder="ex.: próxima quinta, 30 de abril"
          />
          <Button type="button" variant="outline" className={outlineBtn} onClick={onResolveExpression}>
            Resolver
          </Button>
        </div>
      </div>

      <AgendaRecurrenceFields
        durationMinutes={durationMinutes}
        onDurationMinutesChange={onDurationMinutesChange}
        recurrence={recurrence}
        onRecurrenceChange={onRecurrenceChange}
        outlineBtnClass={outlineBtn}
        seriesTitle="Repetir nesta marcação"
        seriesDescription="Define quantidade, dias da semana e duração já na criação — funciona com paciente cadastrado ou só nome na agenda."
      />

      <Button type="submit" className="w-full bg-primary hover:bg-primary/90" disabled={submitting}>
        {submitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Salvando...
          </>
        ) : recurrence.enabled ? (
          "Criar série de marcações"
        ) : (
          "Criar marcação"
        )}
      </Button>
    </form>
  );
}
