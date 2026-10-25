"use client";

import { Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SESSION_DURATION_PRESETS,
  WEEKDAY_OPTIONS,
} from "@/lib/appointment-recurrence";
import { cn } from "@/lib/utils";

export type AgendaRecurrenceFormState = {
  enabled: boolean;
  sessionCount: string;
  weekdays: number[];
};

type Props = {
  durationMinutes: string;
  onDurationMinutesChange: (value: string) => void;
  recurrence: AgendaRecurrenceFormState;
  onRecurrenceChange: (patch: Partial<AgendaRecurrenceFormState>) => void;
  outlineBtnClass?: string;
  /** Quando false, só mostra duração (ex.: marcação já em série). */
  showSeriesControls?: boolean;
  /** Título do bloco de série. */
  seriesTitle?: string;
  seriesDescription?: string;
};

export function AgendaRecurrenceFields({
  durationMinutes,
  onDurationMinutesChange,
  recurrence,
  onRecurrenceChange,
  outlineBtnClass,
  showSeriesControls = true,
  seriesTitle = "Fixar repetição",
  seriesDescription = "Gera as próximas sessões no mesmo horário, nos dias escolhidos. Esta marcação conta como a primeira.",
}: Props) {
  const durationNumber = Number(durationMinutes);

  function toggleWeekday(day: number) {
    const prev = recurrence.weekdays;
    if (prev.includes(day)) {
      const next = prev.filter((d) => d !== day);
      if (next.length === 0) return;
      onRecurrenceChange({ weekdays: next });
      return;
    }
    onRecurrenceChange({ weekdays: [...prev, day].sort((a, b) => a - b) });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="agenda-duration">Duração (min)</Label>
        <div className="grid grid-cols-3 gap-1.5">
          {SESSION_DURATION_PRESETS.map((preset) => (
            <Button
              key={preset}
              type="button"
              size="sm"
              variant={durationNumber === preset ? "default" : "outline"}
              className={cn(
                "h-8 text-xs",
                durationNumber === preset ? undefined : outlineBtnClass,
              )}
              onClick={() => onDurationMinutesChange(String(preset))}
            >
              {preset} min
            </Button>
          ))}
        </div>
        <Input
          id="agenda-duration"
          type="number"
          min={15}
          step={15}
          value={durationMinutes}
          onChange={(e) => onDurationMinutesChange(e.target.value)}
        />
        <p className="text-[11px] leading-snug text-muted-foreground">
          A altura do card na agenda acompanha a duração escolhida.
        </p>
      </div>

      {showSeriesControls ? (
        <div className="space-y-3 rounded-md border border-border/80 bg-muted/40 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-2">
              <Repeat className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <h4 className="text-sm font-semibold">{seriesTitle}</h4>
                <p className="text-[11px] leading-snug text-muted-foreground">{seriesDescription}</p>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant={recurrence.enabled ? "default" : "outline"}
              className={cn("h-8 shrink-0 text-xs", recurrence.enabled ? undefined : outlineBtnClass)}
              onClick={() => onRecurrenceChange({ enabled: !recurrence.enabled })}
            >
              {recurrence.enabled ? "Ativa" : "Ativar"}
            </Button>
          </div>

          {recurrence.enabled ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="agenda-series-count">Quantidade de sessões</Label>
                <Input
                  id="agenda-series-count"
                  type="number"
                  min={2}
                  max={40}
                  value={recurrence.sessionCount}
                  onChange={(e) => onRecurrenceChange({ sessionCount: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Dias da semana</Label>
                <div className="grid grid-cols-7 gap-1">
                  {WEEKDAY_OPTIONS.map((day) => {
                    const selected = recurrence.weekdays.includes(day.value);
                    return (
                      <Button
                        key={day.value}
                        type="button"
                        size="sm"
                        variant={selected ? "default" : "outline"}
                        className={cn(
                          "h-8 px-0 text-[11px]",
                          selected ? undefined : outlineBtnClass,
                        )}
                        onClick={() => toggleWeekday(day.value)}
                        aria-pressed={selected}
                      >
                        {day.short}
                      </Button>
                    );
                  })}
                </div>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
