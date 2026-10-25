"use client";

import { useCallback, useEffect, useState } from "react";
import { YieldScheduleConfigCard } from "@/components/b2b/YieldScheduleConfigCard";
import { YieldIntakePanel } from "@/components/b2b/YieldIntakePanel";
import { getMyPlanLimits } from "@/app/actions/billing";
import { getYieldDashboard } from "@/app/actions/yield-config";
import type { YieldDashboardData } from "@/lib/marketplace/yield-schema";
import { effectivePlanForFeatures, maxAudioSecondsFromLimit, type PlanType } from "@/lib/plan-limits";

type Props = {
  initial: YieldDashboardData;
};

export function YieldManagementClient({ initial }: Props) {
  const [dashboard, setDashboard] = useState(initial);
  const [reloadKey, setReloadKey] = useState(0);
  const [currentPlan, setCurrentPlan] = useState<PlanType>("PREMIUM");
  const [maxAudioSeconds, setMaxAudioSeconds] = useState(120);

  useEffect(() => {
    void getMyPlanLimits().then((r) => {
      if (!r.success) return;
      if (r.plan) setCurrentPlan(effectivePlanForFeatures(r.plan, false));
      if (r.limits) setMaxAudioSeconds(maxAudioSecondsFromLimit(r.limits.maxAudioMinutes));
    });
  }, []);

  const handleApplied = useCallback(async (next: YieldDashboardData | null) => {
    if (next) {
      setDashboard(next);
      setReloadKey((k) => k + 1);
      return;
    }
    const dash = await getYieldDashboard();
    if (dash.success) {
      setDashboard(dash.data);
      setReloadKey((k) => k + 1);
    }
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <YieldIntakePanel
        onApplied={handleApplied}
        currentPlan={currentPlan}
        maxAudioSeconds={maxAudioSeconds}
      />
      <YieldScheduleConfigCard key={reloadKey} initial={dashboard} />
    </div>
  );
}
