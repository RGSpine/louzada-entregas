"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { toast } from "sonner";

import { loadAgenda, moveAgendaTask } from "@/app/actions/logistics";
import { EditCommandBox } from "@/components/dashboard/logistics/EditCommandBox";
import { TaskEditForm } from "@/components/dashboard/logistics/TaskEditForm";
import { AgendaCalendarProvider } from "@/components/dashboard/agenda/AgendaCalendarContext";
import { AgendaScheduleXView } from "@/components/dashboard/agenda/AgendaScheduleXView";
import type { AgendaCalendarAppointment, ScheduleXDateRange } from "@/lib/agenda/schedule-x-mappers";

const TZ = "America/Sao_Paulo";

type AgendaTask = Awaited<ReturnType<typeof loadAgenda>>["tasks"][number];

function wallClock(date: string, time: string): Date {
  return DateTime.fromFormat(`${date} ${time}`, "yyyy-LL-dd HH:mm", { zone: TZ }).toUTC().toJSDate();
}

function plusMinutes(date: string, time: string, minutes: number): Date {
  return DateTime.fromFormat(`${date} ${time}`, "yyyy-LL-dd HH:mm", { zone: TZ })
    .plus({ minutes })
    .toUTC()
    .toJSDate();
}

function toCalendarEvent(task: AgendaTask): AgendaCalendarAppointment {
  const endTime = task.timeWindowEnd ?? task.timeWindowStart ?? "09:00";
  const startTime = task.timeWindowStart ?? endTime;
  let startAt = wallClock(task.targetDate, startTime);
  let endAt = task.timeWindowEnd ? wallClock(task.targetDate, endTime) : plusMinutes(task.targetDate, startTime, 60);
  if (!task.timeWindowStart && task.timeWindowEnd) {
    endAt = wallClock(task.targetDate, task.timeWindowEnd);
    startAt = new Date(endAt.getTime() - 30 * 60 * 1000);
  }
  const safeEnd = endAt.getTime() > startAt.getTime() ? endAt : plusMinutes(task.targetDate, startTime, 30);
  const done = task.status === "CONCLUIDO";
  return {
    id: task.id,
    patientId: task.id,
    patientName: `${task.type === "ENTREGA" ? "Entrega" : "Coleta"} · ${task.name}`,
    patientAgendaColor: done ? "#047857" : "#c2410c",
    professionalName:
      task.status === "EM_ROTA"
        ? `${task.motoboyName ? `Entregador ${task.motoboyName}` : "Sem entregador"} · Em rota`
        : task.motoboyName
          ? `Entregador ${task.motoboyName}`
          : "Sem entregador",
    createdByName: task.createdByName,
    startAt,
    endAt: safeEnd,
    status: task.status === "CONCLUIDO" ? "COMPLETED" : task.status === "CANCELADO" ? "CANCELLED" : "SCHEDULED",
    title: task.workDescription,
    visitKind: "UNIQUE_CONSULTATION",
    careSetting: "IN_PERSON_CLINIC",
    priceCents: null,
    serviceName: task.workDescription,
    professionalServiceId: null,
    hasFinanceIncome: false,
    confirmationStatus: done ? "CONFIRMED" : "PENDING_CONFIRMATION",
    evolutionId: null,
    hasEvolution: false,
  };
}

function bound(value: ScheduleXDateRange["start"]): DateTime {
  return DateTime.fromObject({ year: value.year, month: value.month, day: value.day }, { zone: TZ });
}

function rangeDates(range: ScheduleXDateRange): { from: string; to: string } {
  const start = bound(range.start);
  let end = bound(range.end);
  if (!("hour" in range.end)) end = end.minus({ days: 1 });
  if (end < start) end = start;
  return { from: start.toFormat("yyyy-LL-dd"), to: end.toFormat("yyyy-LL-dd") };
}

export function LogisticsAgenda() {
  const router = useRouter();
  const [tasks, setTasks] = useState<AgendaTask[]>([]);
  const [motoboys, setMotoboys] = useState<Array<{ id: string; name: string }>>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [range, setRange] = useState(() => {
    const today = DateTime.now().setZone(TZ).startOf("day");
    const start = today.minus({ days: today.weekday - 1 });
    return { from: start.toFormat("yyyy-LL-dd"), to: start.plus({ days: 6 }).toFormat("yyyy-LL-dd") };
  });

  const load = useCallback(async (from: string, to: string) => {
    const result = await loadAgenda(from, to);
    setTasks(result.tasks);
    setMotoboys(result.motoboys);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadAgenda(range.from, range.to).then((result) => {
      if (!cancelled) {
        setTasks(result.tasks);
        setMotoboys(result.motoboys);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to]);

  const events = useMemo(() => tasks.map(toCalendarEvent), [tasks]);
  const editing = tasks.find((task) => task.id === editingId) ?? null;

  return (
    <div className="flex min-h-[70vh] flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Agenda</h1>
          <p className="text-sm text-muted-foreground">
            Cada cartão é uma coleta ou entrega, com o cliente e o entregador. Clique para editar, marcar como realizada ou cancelar.
          </p>
        </div>
        <Link href="/dashboard/painel" className="text-sm font-medium text-primary">
          Painel do Dia
        </Link>
      </div>
      <EditCommandBox onChanged={() => void load(range.from, range.to)} />
      {editing ? (
        <TaskEditForm
          task={{
            id: editing.id,
            type: editing.type,
            clientName: editing.name,
            targetDate: editing.targetDate,
            timeWindowStart: editing.timeWindowStart,
            timeWindowEnd: editing.timeWindowEnd,
            motoboyIntraUserId: editing.motoboyIntraUserId,
            status: editing.status,
          }}
          motoboys={motoboys}
          onClose={() => setEditingId(null)}
          onSaved={() => {
            setEditingId(null);
            void load(range.from, range.to);
          }}
        />
      ) : null}
      <AgendaCalendarProvider appointments={events} canUseConfirmationColors>
        <AgendaScheduleXView
          appointments={events}
          timeZone={TZ}
          onSlotClick={(slot) => router.push(`/dashboard/painel?date=${slot.dateValue}`)}
          onEventClick={(taskId) => setEditingId(taskId)}
          onRangeUpdate={(next) => {
            const dates = rangeDates(next);
            setRange(dates);
            void load(dates.from, dates.to);
          }}
          onEventTimeChange={async ({ appointmentId, startAt, endAt }) => {
            const result = await moveAgendaTask(appointmentId, startAt.toISOString(), endAt.toISOString());
            if (!result.ok) {
              toast.error(result.error);
              return false;
            }
            await load(range.from, range.to);
            return true;
          }}
        />
      </AgendaCalendarProvider>
    </div>
  );
}
