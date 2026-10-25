"use client";

import type { CalendarEventExternal } from "@schedule-x/calendar";
import { cn } from "@/lib/utils";
import { useAgendaCalendarContext } from "@/components/dashboard/agenda/AgendaCalendarContext";

type Props = {
  calendarEvent: CalendarEventExternal;
};

function resolvePatientName(title: string, patientName: string | undefined): string {
  if (patientName?.trim()) return patientName.trim();
  const parts = title.split("·");
  return (parts.length > 1 ? parts[parts.length - 1] : title).trim();
}

export function AgendaMonthGridEvent({ calendarEvent }: Props) {
  const { appointmentsById } = useAgendaCalendarContext();
  const item = appointmentsById.get(String(calendarEvent.id));
  const title = calendarEvent.title ?? "";
  const patientName = resolvePatientName(title, item?.patientName);
  const courierLine = item?.professionalName?.trim() || "Sem entregador";
  const timeText = title.includes("·") ? title.split("·")[0]!.trim() : null;
  const status = (calendarEvent._status as string | undefined) ?? item?.status ?? "SCHEDULED";
  const isNoShow = status === "NO_SHOW";
  const isCancelled = status === "CANCELLED";
  const isDone = status === "COMPLETED";

  return (
    <div
      className={cn(
        "agenda-month-grid-event truncate rounded-md border-0 px-1.5 py-0.5 text-[10px] font-medium leading-tight",
        isNoShow || isCancelled
          ? "bg-[#fecaca] text-[#7f1d1d]"
          : isDone
            ? "bg-[#bbf7d0] text-[#064e3b]"
            : "bg-[#fed7aa] text-[#7c2d12]",
        isCancelled && "line-through",
      )}
      title={[timeText, patientName, courierLine, isNoShow ? "Faltou" : null].filter(Boolean).join(" · ")}
    >
      {timeText ? `${timeText} · ` : ""}
      {patientName}
      {` · ${courierLine}`}
    </div>
  );
}
