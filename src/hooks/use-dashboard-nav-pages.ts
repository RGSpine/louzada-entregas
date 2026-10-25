"use client";

import { useEffect, useState } from "react";
import { getMyPlanLimits } from "@/app/actions/billing";
import {
  DEFAULT_DASHBOARD_NAV_PAGES,
  filterDashboardNavPages,
} from "@/lib/dashboard-nav-filter";
import type { DashboardNavPageDef } from "@/lib/dashboard-nav-pages";

/** Páginas do menu ☰ / sidebar, filtradas pelo plano do usuário. */
export function useDashboardNavPages(): DashboardNavPageDef[] {
  const [pages, setPages] = useState<DashboardNavPageDef[]>(DEFAULT_DASHBOARD_NAV_PAGES);

  useEffect(() => {
    void getMyPlanLimits().then((r) => {
      if (!r.success) return;
      setPages(
        filterDashboardNavPages(DEFAULT_DASHBOARD_NAV_PAGES, {
          canUsePatientClinicalChat: r.canUsePatientClinicalChat,
          canUseOfficeFinance: r.canUseOfficeFinance,
          canUseYieldManagement: r.canUseYieldManagement,
        }),
      );
    });
  }, []);

  return pages;
}
