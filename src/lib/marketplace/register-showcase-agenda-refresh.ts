import { scheduleShowcaseAgendaRefresh } from "@/lib/marketplace/showcase-agenda";
import { setShowcaseAgendaRefresh } from "@/lib/showcase-agenda-refresh-hook";

export function registerShowcaseAgendaRefresh(): void {
  setShowcaseAgendaRefresh(scheduleShowcaseAgendaRefresh);
}
