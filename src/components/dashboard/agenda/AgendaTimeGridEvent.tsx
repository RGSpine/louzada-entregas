"use client";

import type { CalendarEventExternal } from "@schedule-x/calendar";
import {
  appointmentGridFillClasses,
  formatConfirmationStatusLabel,
  isPendingConfirmation,
} from "@/lib/appointment-confirmation";
import { cn } from "@/lib/utils";
import { useAgendaCalendarContext } from "@/components/dashboard/agenda/AgendaCalendarContext";

type Props = {
  calendarEvent: CalendarEventExternal;
};

function resolvePatientName(
  title: string,
  patientName: string | undefined,
): string {
  if (patientName?.trim()) return patientName.trim();
  const parts = title.split("·");
  return (parts.length > 1 ? parts[parts.length - 1] : title).trim();
}

function appointmentDurationMinutes(
  startAt: Date | string | undefined,
  endAt: Date | string | undefined,
): number {
  if (!startAt || !endAt) return 60;
  const ms = new Date(endAt).getTime() - new Date(startAt).getTime();
  return ms > 0 ? ms / 60_000 : 60;
}

/**
 * Evento na grade.
 * Em ≤60 min a altura da célula não cabe 3 linhas — usa 2 linhas:
 *   Nome
 *   08:00 · Falta confirmar
 * Em slots maiores, nome / hora / status em linhas separadas.
 */
export function AgendaTimeGridEvent({ calendarEvent }: Props) {
  const { appointmentsById, canUseConfirmationColors } = useAgendaCalendarContext();
  const item = appointmentsById.get(String(calendarEvent.id));
  const title = calendarEvent.title ?? "";
  const patientColor =
    (calendarEvent._patientAgendaColor as string | undefined) ??
    item?.patientAgendaColor ??
    "#00008f";
  const spaceColor =
    (calendarEvent._serviceSpaceColor as string | undefined) ?? item?.serviceSpaceColor ?? null;
  const barColor =
    spaceColor ??
    (calendarEvent._professionalColor as string | undefined) ??
    item?.professionalColor ??
    patientColor;

  const confirmationStatus =
    (calendarEvent._confirmationStatus as string | undefined) ??
    item?.confirmationStatus ??
    "PENDING_CONFIRMATION";
  const status = (calendarEvent._status as string | undefined) ?? item?.status ?? "SCHEDULED";
  const isNoShow = status === "NO_SHOW";
  const patientName = resolvePatientName(title, item?.patientName);
  const courierLine = item?.professionalName?.trim() || null;
  const createdByLine = item?.createdByName ? `Criada por ${item.createdByName}` : null;
  const isCancelled = status === "CANCELLED";
  const isDone = status === "COMPLETED";
  const timeText = title.includes("·") ? title.split("·")[0]!.trim() : null;

  const durationMinutes = appointmentDurationMinutes(item?.startAt, item?.endAt);
  /** 1h (e menores): layout compacto em 2 linhas para não cortar “Falta confirmar”. */
  const isHourOrShorter = durationMinutes <= 60;

  const fill = isNoShow
    ? "bg-destructive/15 text-destructive dark:bg-destructive/20"
    : appointmentGridFillClasses(
        confirmationStatus as "PENDING_CONFIRMATION" | "CONFIRMED",
        canUseConfirmationColors,
      );

  const isPending =
    !isNoShow &&
    canUseConfirmationColors &&
    isPendingConfirmation(confirmationStatus as "PENDING_CONFIRMATION" | "CONFIRMED");

  const pendingLabel = isNoShow
    ? "Faltou"
    : formatConfirmationStatusLabel(
        confirmationStatus as "PENDING_CONFIRMATION" | "CONFIRMED",
      );

  const showStatusLabel = isNoShow || isPending || isCancelled || isDone;
  const outcomeLabel = isCancelled ? "Cancelada" : isDone ? "Realizada" : pendingLabel;

  const metaLine = [timeText, showStatusLabel ? outcomeLabel : null].filter(Boolean).join(" · ");

  const tooltip = [patientName, courierLine, createdByLine, timeText, showStatusLabel ? outcomeLabel : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className="agenda-time-grid-event relative flex h-full min-h-0 min-w-0 w-full max-w-full flex-col justify-start overflow-hidden rounded-sm border-0 bg-card text-foreground"
      style={{
        boxShadow: `inset 3px 0 0 0 ${barColor}, 0 1px 2px rgb(0 0 0 / 0.08)`,
      }}
      title={tooltip}
    >
      {/* Tint por cima do fundo opaco: cobre as linhas da grade sem perder a cor de status. */}
      <div className={cn("pointer-events-none absolute inset-0", fill)} aria-hidden />
      <div
        className={cn(
          "relative z-[1] flex min-h-0 min-w-0 w-full flex-1 flex-col justify-start overflow-hidden py-0.5 pl-2 pr-1",
          isHourOrShorter ? "gap-0" : "gap-0.5",
          "max-lg:items-center max-lg:justify-center max-lg:px-0.5 max-lg:text-center",
          "lg:items-stretch lg:text-left",
        )}
      >
        <p
          className={cn(
            "min-w-0 shrink-0 truncate font-semibold leading-none max-lg:text-center",
            isHourOrShorter ? "text-[10px]" : "text-[10px] lg:text-[11px] leading-snug",
          )}
        >
          {patientName}
        </p>
        {courierLine ? (
          <p className={cn("min-w-0 truncate text-[9px] leading-snug opacity-80", isCancelled && "line-through")}>
            {courierLine}
          </p>
        ) : null}
        {createdByLine ? (
          <p className="min-w-0 truncate text-[9px] leading-snug text-muted-foreground">{createdByLine}</p>
        ) : null}

        {isHourOrShorter ? (
          metaLine ? (
            <span className="flex min-w-0 shrink-0 items-baseline justify-center gap-1 overflow-hidden text-[9px] leading-none max-lg:text-center lg:justify-start">
              {timeText ? (
                <span className="shrink-0 font-medium opacity-80">{timeText}</span>
              ) : null}
              {timeText && showStatusLabel ? (
                <span className="shrink-0 opacity-40" aria-hidden>
                  ·
                </span>
              ) : null}
              {showStatusLabel ? (
                <span className={cn("min-w-0 truncate font-medium", isNoShow || isCancelled ? "text-destructive" : isDone ? "text-foreground" : "text-warning")}>{outcomeLabel}</span>
              ) : null}
            </span>
          ) : null
        ) : (
          <>
            {timeText ? (
              <span className="min-w-0 shrink-0 truncate text-[10px] font-medium leading-snug opacity-80 max-lg:text-center">
                {timeText}
              </span>
            ) : null}
            {showStatusLabel ? (
              <span className={cn("min-w-0 shrink-0 truncate text-[9px] font-medium leading-snug max-lg:text-center", isNoShow || isCancelled ? "text-destructive" : isDone ? "text-foreground" : "text-warning")}>
                {outcomeLabel}
              </span>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
