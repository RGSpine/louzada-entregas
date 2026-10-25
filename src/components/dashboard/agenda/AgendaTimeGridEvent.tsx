"use client";

import type { CalendarEventExternal } from "@schedule-x/calendar";
import { cn } from "@/lib/utils";
import { useAgendaCalendarContext } from "@/components/dashboard/agenda/AgendaCalendarContext";

const SAO_PAULO = "America/Sao_Paulo";

function clock(value: Date | string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: SAO_PAULO,
  }).format(date);
}

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

/** Card da grade: horário, cliente e entregador. Quem registrou fica em Registros. */
export function AgendaTimeGridEvent({ calendarEvent }: Props) {
  const { appointmentsById } = useAgendaCalendarContext();
  const item = appointmentsById.get(String(calendarEvent.id));
  const title = calendarEvent.title ?? "";
  const status = (calendarEvent._status as string | undefined) ?? item?.status ?? "SCHEDULED";
  const isNoShow = status === "NO_SHOW";
  const clientName = resolvePatientName(title, item?.patientName);
  const courierLine = item?.professionalName?.trim() || "Sem entregador";
  const isCancelled = status === "CANCELLED";
  const isDone = status === "COMPLETED";
  const startClock = clock(item?.startAt);
  const endClock = clock(item?.endAt);
  const timeText = startClock && endClock && startClock !== endClock ? `${startClock}–${endClock}` : startClock ?? "Sem horário";

  const state = isNoShow || isCancelled ? "cancelled" : isDone ? "done" : "open";
  const backgroundColor = state === "done" ? "#bbf7d0" : state === "cancelled" ? "#fecaca" : "#fed7aa";
  const tooltip = [timeText, clientName, courierLine, isDone ? "Realizada" : isCancelled ? "Cancelada" : "Em aberto"]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      data-agenda-state={state}
      className="agenda-time-grid-event relative flex h-full min-h-0 min-w-0 w-full max-w-full flex-col justify-center overflow-hidden text-foreground"
      style={{ backgroundColor }}
      title={tooltip}
    >
      <div
        className={cn(
          "relative z-[1] flex min-h-0 min-w-0 w-full flex-col justify-center gap-0.5 overflow-hidden px-2 py-1",
          "max-lg:items-center max-lg:text-center",
          "lg:items-stretch lg:text-left",
          isCancelled && "line-through",
        )}
      >
        <p className="min-w-0 shrink-0 truncate text-[10px] font-semibold leading-tight">{timeText}</p>
        <p className="min-w-0 shrink-0 truncate text-[11px] font-semibold leading-tight">{clientName}</p>
        <p className="min-w-0 shrink-0 truncate text-[10px] leading-tight opacity-80">{courierLine}</p>
      </div>
    </div>
  );
}
