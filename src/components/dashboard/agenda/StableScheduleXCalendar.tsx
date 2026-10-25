"use client";

import { useRef, type ComponentProps } from "react";
import { ScheduleXCalendar } from "@schedule-x/react";
import type { CalendarApp } from "@schedule-x/calendar";

type CustomComponents = NonNullable<
  ComponentProps<typeof ScheduleXCalendar>["customComponents"]
>;

type Props = {
  calendarApp: CalendarApp;
  customComponents: CustomComponents;
};

/**
 * Wrapper que **congela** a referência de `customComponents` no primeiro mount.
 *
 * O `@schedule-x/react` inclui `customComponents` nas deps do effect de
 * render/destroy. Objeto novo a cada paint do parent → destroy + render no
 * calendário já morto → tela preta do Next. Este wrapper impede regressão
 * mesmo se alguém voltar a passar `{{ timeGridEvent: ... }}` inline.
 */
export function StableScheduleXCalendar({ calendarApp, customComponents }: Props) {
  const stableComponentsRef = useRef<CustomComponents>(customComponents);
  return (
    <ScheduleXCalendar
      calendarApp={calendarApp}
      customComponents={stableComponentsRef.current}
    />
  );
}
