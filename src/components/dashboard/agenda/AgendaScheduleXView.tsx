"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createCalendar,
  createViewDay,
  createViewMonthGrid,
  createViewWeek,
  type CalendarApp,
  type CalendarEventExternal,
} from "@schedule-x/calendar";
import { createEventsServicePlugin } from "@schedule-x/events-service";
import { createResizePlugin } from "@schedule-x/resize";
import "temporal-polyfill/global";
import "@schedule-x/theme-default/dist/index.css";
import "@/styles/agenda-schedule-x.css";
import { AgendaCalendarErrorBoundary } from "@/components/dashboard/agenda/AgendaCalendarErrorBoundary";
import { AgendaTimeGridEvent } from "@/components/dashboard/agenda/AgendaTimeGridEvent";
import { AgendaMonthGridEvent } from "@/components/dashboard/agenda/AgendaMonthGridEvent";
import { StableScheduleXCalendar } from "@/components/dashboard/agenda/StableScheduleXCalendar";
import { appointmentToCalendarEvent } from "@/lib/agenda/schedule-x-mappers";
import type {
  AgendaCalendarAppointment,
  ScheduleXDateRange,
} from "@/lib/agenda/schedule-x-mappers";
import { scheduleXDateTimeToUtcDate, snapTimeValue } from "@/lib/agenda/agenda-time-edit";
import { createAgendaDragAndDropPlugin } from "@/lib/agenda/schedule-x-dnd-compat";
import { logger } from "@/lib/logger";

/**
 * Obrigatório: referência estável de módulo.
 * Nunca passar `customComponents={{ timeGridEvent: ... }}` inline — o
 * Schedule-X faz destroy+render e pode crashar a página.
 * @see StableScheduleXCalendar
 */
const SCHEDULE_X_CUSTOM_COMPONENTS = {
  timeGridEvent: AgendaTimeGridEvent,
  monthGridEvent: AgendaMonthGridEvent,
};

/**
 * Semana (grade) + Dia + Mês. A grade Semana do Schedule-X vem com
 * hasSmallScreenCompat=false e some no mobile — forçamos true para o seletor
 * mostrar Semana e Mês também em telas estreitas.
 */
function createPortugueseViews() {
  const week = createViewWeek();
  week.label = "Semana";
  week.hasSmallScreenCompat = true;
  const day = createViewDay();
  day.label = "Dia";
  const month = createViewMonthGrid();
  month.label = "Mês";
  month.hasSmallScreenCompat = true;
  return [week, day, month] as const;
}

/**
 * Altura da grade: 14h de dia (07–21) → cada hora ≈ height/14.
 * Precisamos ≥ ~56px/h para caber texto em slots de 1h; floor 800 no desktop.
 */
function computeWeekGridHeight(): number {
  if (typeof window === "undefined") return 840;
  const isNarrow = window.innerWidth < 700;
  const chrome = isNarrow ? 220 : 160;
  const available = window.innerHeight - chrome;
  if (isNarrow) return Math.min(Math.max(available, 520), 780);
  return Math.min(Math.max(available, 800), 980);
}

function temporalAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof Temporal !== "undefined" &&
    typeof Temporal.Now?.zonedDateTimeISO === "function" &&
    typeof Temporal.ZonedDateTime?.from === "function"
  );
}

/** Tema visual real: ClinicalThemeSync / bootstrap controlam a classe `.dark`. */
function documentIsDark(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
  );
}

type EventsServicePlugin = ReturnType<typeof createEventsServicePlugin>;

function eventsFacadeReady(plugin: EventsServicePlugin): boolean {
  return Boolean((plugin as { eventsFacade?: unknown }).eventsFacade);
}

export type AgendaSlotSelection = {
  dateValue: string;
  timeValue: string;
};

export type AgendaEventTimeChange = {
  appointmentId: string;
  startAt: Date;
  endAt: Date;
};

type Props = {
  appointments: AgendaCalendarAppointment[];
  timeZone: string;
  onSlotClick: (slot: AgendaSlotSelection) => void;
  onEventClick: (appointmentId: string) => void;
  onRangeUpdate: (range: ScheduleXDateRange) => void;
  /** Persistir remarcação por arraste/redimensionamento. Return false cancela. */
  onEventTimeChange?: (change: AgendaEventTimeChange) => boolean | Promise<boolean>;
};

/**
 * Grade Schedule-X da agenda.
 *
 * Ciclo de vida (Fase B):
 * - createCalendar só quando client montou + timeZone + remountKey mudam
 * - appointments / loading / plano NÃO recriam o calendário (só eventsService.set)
 * - destroy fica a cargo exclusivo do ScheduleXCalendar (effect cleanup)
 * - tema dark/light via setTheme + classe `.dark` (não depende de resolvedTheme
 *   light|dark — o app usa também o tema "auto")
 */
export function AgendaScheduleXView({
  appointments,
  timeZone,
  onSlotClick,
  onEventClick,
  onRangeUpdate,
  onEventTimeChange,
}: Props) {
  const [calendar, setCalendar] = useState<CalendarApp | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [remountKey, setRemountKey] = useState(0);
  /** Evita createCalendar no SSR; não usar resolvedTheme==="light"|"dark" (tema "auto" trava). */
  const [clientReady, setClientReady] = useState(false);
  const eventsService = useMemo(() => createEventsServicePlugin(), []);
  /** Free DnD@3.x + calendar@4.6: precisa do bridge start*Drag (ver schedule-x-dnd-compat). */
  const dragAndDrop = useMemo(() => createAgendaDragAndDropPlugin(15), []);
  const resizePlugin = useMemo(() => createResizePlugin(15), []);
  const onSlotClickRef = useRef(onSlotClick);
  const onEventClickRef = useRef(onEventClick);
  const onRangeUpdateRef = useRef(onRangeUpdate);
  const onEventTimeChangeRef = useRef(onEventTimeChange);
  const timeZoneRef = useRef(timeZone);
  const appointmentsRef = useRef(appointments);

  useEffect(() => {
    setClientReady(true);
  }, []);

  useEffect(() => {
    onSlotClickRef.current = onSlotClick;
    onEventClickRef.current = onEventClick;
    onRangeUpdateRef.current = onRangeUpdate;
    onEventTimeChangeRef.current = onEventTimeChange;
  }, [onSlotClick, onEventClick, onRangeUpdate, onEventTimeChange]);

  useEffect(() => {
    timeZoneRef.current = timeZone;
  }, [timeZone]);

  useEffect(() => {
    appointmentsRef.current = appointments;
  }, [appointments]);

  const pushEventsToCalendar = (plugin: EventsServicePlugin) => {
    if (!eventsFacadeReady(plugin)) return;
    const events: CalendarEventExternal[] = [];
    for (const a of appointmentsRef.current) {
      try {
        events.push(appointmentToCalendarEvent(a, timeZoneRef.current));
      } catch (e) {
        logger.warn("evento ignorado (datas inválidas)", {
          feature: "agenda-calendar",
          appointmentId: a.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    try {
      plugin.set(events);
    } catch (e) {
      logger.error("eventsService.set failed", {
        feature: "agenda-calendar",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  // createCalendar próprio: useNextCalendarApp só monta 1× e engolia novas views.
  useEffect(() => {
    if (!clientReady) return;

    if (!temporalAvailable()) {
      setInitError("O calendário precisa do suporte Temporal neste navegador.");
      setCalendar(null);
      return;
    }

    let app: CalendarApp | null = null;
    const initialIsDark = documentIsDark();

    try {
      const views = createPortugueseViews();
      app = createCalendar(
        {
          locale: "pt-BR",
          firstDayOfWeek: 1,
          timezone: timeZone,
          defaultView: "week",
          views: [...views],
          dayBoundaries: { start: "07:00", end: "21:00" },
          weekOptions: {
            gridStep: 15,
            gridHeight: computeWeekGridHeight(),
            eventWidth: 95,
            eventOverlap: false,
          },
          isDark: initialIsDark,
          // locale pt-BR → dicionário nativo `ptBR` (Today/View/Date já em português).
          // NÃO passar translations com chave "pt-BR": isso apaga o mapa e devolve as keys em inglês.
          calendars: {
            appointment: {
              colorName: "appointment",
              lightColors: {
                main: "#00008f",
                container: "#e8e8f8",
                onContainer: "#12163a",
              },
              darkColors: {
                main: "#b9baff",
                container: "#1a1a40",
                onContainer: "#eef0ff",
              },
            },
          },
          callbacks: {
            onRender() {
              // beforeRender do plugin já rodou — seguro chamar set.
              pushEventsToCalendar(eventsService);
            },
            onClickDateTime(dateTime) {
              const tz = timeZoneRef.current;
              const dt = dateTime.withTimeZone(tz);
              const rawTime = `${String(dt.hour).padStart(2, "0")}:${String(dt.minute).padStart(2, "0")}`;
              onSlotClickRef.current({
                dateValue: `${String(dt.year).padStart(4, "0")}-${String(dt.month).padStart(2, "0")}-${String(dt.day).padStart(2, "0")}`,
                timeValue: snapTimeValue(rawTime, 5),
              });
            },
            onClickDate(date) {
              onSlotClickRef.current({
                dateValue: `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`,
                timeValue: "09:00",
              });
            },
            onEventClick(event) {
              onEventClickRef.current(String(event.id));
            },
            onRangeUpdate(range) {
              onRangeUpdateRef.current(range);
            },
            async onBeforeEventUpdateAsync(_oldEvent, newEvent) {
              const handler = onEventTimeChangeRef.current;
              if (!handler) return false;
              try {
                const tz = timeZoneRef.current;
                const startAt = scheduleXDateTimeToUtcDate(newEvent.start, tz);
                const endAt = scheduleXDateTimeToUtcDate(newEvent.end, tz);
                if (!(endAt.getTime() > startAt.getTime())) return false;
                const ok = await handler({
                  appointmentId: String(newEvent.id),
                  startAt,
                  endAt,
                });
                return ok !== false;
              } catch (e) {
                logger.error("onBeforeEventUpdateAsync failed", {
                  feature: "agenda-calendar",
                  error: e instanceof Error ? e.message : String(e),
                });
                return false;
              }
            },
          },
        },
        [eventsService, dragAndDrop, resizePlugin],
      );
    } catch (e) {
      logger.error("createCalendar failed", {
        feature: "agenda-calendar",
        error: e instanceof Error ? e.message : String(e),
      });
      setInitError(e instanceof Error ? e.message : "Falha ao iniciar o calendário.");
      setCalendar(null);
      return;
    }

    setInitError(null);
    setCalendar(app);

    // destroy: exclusivo do StableScheduleXCalendar → ScheduleXCalendar cleanup.
    // Não chamar app.destroy() aqui (destroy duplo também crasha).
    return () => {
      setCalendar(null);
    };
    // appointments / loading / plano propositalmente fora das deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pushEvents usa refs
  }, [eventsService, dragAndDrop, resizePlugin, timeZone, clientReady, remountKey]);

  useEffect(() => {
    if (!eventsService || !calendar) return;
    pushEventsToCalendar(eventsService);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pushEvents usa refs
  }, [appointments, eventsService, timeZone, calendar]);

  useEffect(() => {
    if (!calendar || !clientReady) return;

    const apply = () => {
      try {
        calendar.setTheme(documentIsDark() ? "dark" : "light");
      } catch (e) {
        logger.warn("setTheme failed", {
          feature: "agenda-calendar",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    };

    apply();
    const root = document.documentElement;
    const observer = new MutationObserver(apply);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [calendar, clientReady]);

  const retry = () => {
    setInitError(null);
    setCalendar(null);
    setRemountKey((k) => k + 1);
  };

  if (initError) {
    return (
      <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card px-4 text-center">
        <p className="text-sm font-medium text-foreground">Não foi possível iniciar a agenda.</p>
        <p className="max-w-sm text-xs text-muted-foreground">{initError}</p>
        <button
          type="button"
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          onClick={retry}
        >
          Tentar de novo
        </button>
      </div>
    );
  }

  if (!calendar) {
    return (
      <div className="flex h-full min-h-[240px] items-center justify-center text-sm text-muted-foreground">
        Preparando calendário…
      </div>
    );
  }

  return (
    <AgendaCalendarErrorBoundary onRetry={retry}>
      <div className="agenda-schedule-x-root flex h-full min-h-0 w-full flex-col">
        <StableScheduleXCalendar
          calendarApp={calendar}
          customComponents={SCHEDULE_X_CUSTOM_COMPONENTS}
        />
      </div>
    </AgendaCalendarErrorBoundary>
  );
}
