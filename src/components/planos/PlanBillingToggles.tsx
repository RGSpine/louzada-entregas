"use client";

import type { PlanSegment } from "@/lib/plan-tier";

type Props = {
  segment: PlanSegment;
  isAnnual: boolean;
  onSegmentChange: (segment: PlanSegment) => void;
  onBillingChange: (isAnnual: boolean) => void;
  className?: string;
};

function toggleButtonClass(active: boolean): string {
  return active
    ? "bg-card text-foreground shadow-[var(--shadow-elevation-1)]"
    : "text-muted-foreground hover:text-foreground";
}

export function PlanBillingToggles({
  segment,
  isAnnual,
  onSegmentChange,
  onBillingChange,
  className,
}: Props) {
  return (
    <div className={className ?? "space-y-4"}>
      <div className="inline-flex items-center gap-3 rounded-lg bg-muted p-1.5">
        <button
          type="button"
          onClick={() => onSegmentChange("INDIVIDUAL")}
          className={`min-h-[2.75rem] rounded-md px-4 py-2 text-sm font-medium transition-colors ${toggleButtonClass(segment === "INDIVIDUAL")}`}
        >
          Individual
        </button>
        <button
          type="button"
          onClick={() => onSegmentChange("CLINICA")}
          className={`min-h-[2.75rem] rounded-md px-4 py-2 text-sm font-medium transition-colors ${toggleButtonClass(segment === "CLINICA")}`}
        >
          Clínica
        </button>
      </div>

      <div className="inline-flex items-center gap-3 rounded-lg bg-muted p-1.5">
        <button
          type="button"
          onClick={() => onBillingChange(false)}
          className={`min-h-[2.75rem] rounded-md px-4 py-2 text-sm font-medium transition-colors ${toggleButtonClass(!isAnnual)}`}
        >
          Mensal
        </button>
        <button
          type="button"
          onClick={() => onBillingChange(true)}
          className={`relative min-h-[2.75rem] rounded-md px-4 py-2 text-sm font-medium transition-colors ${toggleButtonClass(isAnnual)}`}
        >
          Anual
          <span className="absolute -right-1 -top-1 rounded bg-clinical px-1.5 py-0.5 text-[10px] font-bold text-clinical-foreground">
            -20%
          </span>
        </button>
      </div>
    </div>
  );
}
