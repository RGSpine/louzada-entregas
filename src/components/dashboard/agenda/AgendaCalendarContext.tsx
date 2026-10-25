"use client";

import { createContext, useContext, useMemo } from "react";
import type { AgendaCalendarAppointment } from "@/lib/agenda/schedule-x-mappers";

type AgendaCalendarContextValue = {
  appointmentsById: Map<string, AgendaCalendarAppointment>;
  canUseConfirmationColors: boolean;
};

const AgendaCalendarContext = createContext<AgendaCalendarContextValue>({
  appointmentsById: new Map(),
  canUseConfirmationColors: false,
});

export function AgendaCalendarProvider({
  appointments,
  canUseConfirmationColors,
  children,
}: {
  appointments: AgendaCalendarAppointment[];
  canUseConfirmationColors: boolean;
  children: React.ReactNode;
}) {
  const value = useMemo<AgendaCalendarContextValue>(
    () => ({
      appointmentsById: new Map(appointments.map((a) => [a.id, a])),
      canUseConfirmationColors,
    }),
    [appointments, canUseConfirmationColors],
  );
  return (
    <AgendaCalendarContext.Provider value={value}>
      {children}
    </AgendaCalendarContext.Provider>
  );
}

export function useAgendaCalendarContext() {
  return useContext(AgendaCalendarContext);
}
