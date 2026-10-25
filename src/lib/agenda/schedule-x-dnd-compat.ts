import { createDragAndDropPlugin } from "@schedule-x/drag-and-drop";

type FreeDnDPlugin = ReturnType<typeof createDragAndDropPlugin>;

/**
 * Calendar Schedule-X ≥4.6 chama `startTimeGridDrag` / `startDateGridDrag` /
 * `startMonthGridDrag`. O pacote free `@schedule-x/drag-and-drop@3.x` ainda
 * expõe só `create*Handler`. Sem este bridge o cursor vira "mão" (CSS) mas o
 * drag aborta com TypeError em `startTimeGridDrag is not a function`.
 */
export function createAgendaDragAndDropPlugin(minutesPerInterval = 15): FreeDnDPlugin {
  const base = createDragAndDropPlugin(minutesPerInterval);

  Object.assign(base, {
    startTimeGridDrag(
      dependencies: Parameters<FreeDnDPlugin["createTimeGridDragHandler"]>[0],
      dayBoundariesDateTime: Parameters<FreeDnDPlugin["createTimeGridDragHandler"]>[1],
    ) {
      return base.createTimeGridDragHandler(dependencies, dayBoundariesDateTime);
    },
    startDateGridDrag(dependencies: Parameters<FreeDnDPlugin["createDateGridDragHandler"]>[0]) {
      return base.createDateGridDragHandler(dependencies);
    },
    startMonthGridDrag(
      calendarEvent: Parameters<FreeDnDPlugin["createMonthGridDragHandler"]>[0],
      $app: Parameters<FreeDnDPlugin["createMonthGridDragHandler"]>[1],
    ) {
      return base.createMonthGridDragHandler(calendarEvent, $app);
    },
  });

  return base;
}

export function agendaDnDPluginHasV4Bridge(plugin: FreeDnDPlugin): boolean {
  const surface = plugin as FreeDnDPlugin & {
    startTimeGridDrag?: unknown;
    startDateGridDrag?: unknown;
    startMonthGridDrag?: unknown;
  };
  return (
    typeof surface.startTimeGridDrag === "function" &&
    typeof surface.startDateGridDrag === "function" &&
    typeof surface.startMonthGridDrag === "function" &&
    typeof plugin.createTimeGridDragHandler === "function"
  );
}
