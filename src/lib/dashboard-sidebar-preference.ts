/** Preferência local: menu lateral fixo visível no desktop (≥1024px). */
export const DASHBOARD_SIDEBAR_PINNED_KEY = "clinical-dashboard-sidebar-pinned";

/** Preferência do mapa logado do paciente — não mistura com o menu do profissional. */
export const PATIENT_MAP_SIDEBAR_PINNED_KEY = "patient-map-sidebar-pinned";

export function readDashboardSidebarPinned(
  storageKey = DASHBOARD_SIDEBAR_PINNED_KEY,
): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw === "0") return false;
    return true;
  } catch {
    return true;
  }
}

export function writeDashboardSidebarPinned(
  pinned: boolean,
  storageKey = DASHBOARD_SIDEBAR_PINNED_KEY,
): void {
  try {
    localStorage.setItem(storageKey, pinned ? "1" : "0");
  } catch {
    /* ignore */
  }
}
