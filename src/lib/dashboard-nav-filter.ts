import {
  DASHBOARD_NAV_PAGES,
  type DashboardNavPageDef,
} from "@/lib/dashboard-nav-pages";

export type DashboardNavPlanFlags = {
  canUsePatientClinicalChat?: boolean;
  canUseOfficeFinance?: boolean;
  canUseYieldManagement?: boolean;
};

/** Oculta rotas Premium do menu quando o plano não permite acesso direto. */
export function filterDashboardNavPages(
  pages: readonly DashboardNavPageDef[],
  flags: DashboardNavPlanFlags | null | undefined,
): DashboardNavPageDef[] {
  if (!flags) return [...pages];
  return pages.filter((page) => {
    if (page.href === "/dashboard/clinical-chat" && flags.canUsePatientClinicalChat !== true) {
      return false;
    }
    if (page.href === "/dashboard/finances" && flags.canUseOfficeFinance !== true) {
      return false;
    }
    if (page.href === "/dashboard/gestao-inteligente" && flags.canUseYieldManagement !== true) {
      return false;
    }
    return true;
  });
}

export const DEFAULT_DASHBOARD_NAV_PAGES: DashboardNavPageDef[] = [...DASHBOARD_NAV_PAGES];
