import { describe, expect, it } from "vitest";
import {
  agendaDnDPluginHasV4Bridge,
  createAgendaDragAndDropPlugin,
} from "@/lib/agenda/schedule-x-dnd-compat";
import { createDragAndDropPlugin } from "@schedule-x/drag-and-drop";

describe("schedule-x-dnd-compat", () => {
  it("plugin free nu não tem startTimeGridDrag (API v4)", () => {
    const raw = createDragAndDropPlugin(15) as { startTimeGridDrag?: unknown };
    expect(typeof raw.startTimeGridDrag).toBe("undefined");
  });

  it("adapter expõe bridge v4 + handlers v3", () => {
    const plugin = createAgendaDragAndDropPlugin(15);
    expect(agendaDnDPluginHasV4Bridge(plugin)).toBe(true);
    expect(plugin.name).toBe("dragAndDrop");
  });
});
