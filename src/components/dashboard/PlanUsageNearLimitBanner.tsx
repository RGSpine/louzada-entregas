"use client";

import Link from "next/link";
import { AlertTriangle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PlanUsageWarning } from "@/lib/plan-usage-banner";

type Props = {
  warnings: PlanUsageWarning[];
  className?: string;
};

export function PlanUsageNearLimitBanner({ warnings, className }: Props) {
  if (warnings.length === 0) return null;

  const hasHardLimit = warnings.some((w) => w.atLimit);

  return (
    <div
      className={cn(
        "mb-6 rounded-xl border px-4 py-4 shadow-[var(--shadow-elevation-1)]",
        hasHardLimit
          ? "border-warning/40 bg-warning/10 dark:border-warning/50 dark:bg-warning/15"
          : "border-primary/30 bg-primary/10 dark:border-primary/40 dark:bg-primary/15",
        className,
      )}
      role="status"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <div
            className={cn(
              "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
              hasHardLimit
                ? "bg-warning/15 text-warning"
                : "bg-primary/15 text-primary",
            )}
          >
            {hasHardLimit ? (
              <AlertTriangle className="h-5 w-5" aria-hidden />
            ) : (
              <Sparkles className="h-5 w-5" aria-hidden />
            )}
          </div>
          <div className="space-y-2">
            {warnings.map((warning) => (
              <div key={warning.kind}>
                <p className="font-semibold text-foreground">{warning.title}</p>
                <p className="text-sm text-muted-foreground">{warning.message}</p>
              </div>
            ))}
          </div>
        </div>
        <Button asChild size="sm" variant="clinical" className="shrink-0">
          <Link href="/dashboard/planos">Ver planos e fazer upgrade</Link>
        </Button>
      </div>
    </div>
  );
}
