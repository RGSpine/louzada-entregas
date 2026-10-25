"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getFinancePeriodReport } from "@/app/actions/clinic-finances";
import type { FinancePeriodReport as ReportData } from "@/app/actions/clinic-finances";
import { FINANCE_PERIOD_PRESETS, type FinancePeriodPreset } from "@/lib/finance/period";
import { formatBrlFromCents } from "./finance-format";
import { financeOutlineBtnClass } from "./finance-outline-btn";
import { FinancePeriodBreakdown } from "./FinancePeriodBreakdown";

const PRESET_LABEL: Record<FinancePeriodPreset, string> = {
  DAY: "Dia",
  WEEK: "Semana",
  MONTH: "Mês",
  QUARTER: "Trimestre",
  SEMESTER: "Semestre",
  YEAR: "Ano",
};

function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct === null) {
    return <span className="text-xs text-muted-foreground">— sem base anterior</span>;
  }
  const up = pct >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        up ? "text-clinical" : "text-destructive dark:text-destructive",
      )}
    >
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? "+" : ""}
      {pct}% vs período anterior
    </span>
  );
}

export function FinancePeriodReport({ reloadKey = 0 }: { reloadKey?: number }) {
  const [preset, setPreset] = useState<FinancePeriodPreset>("MONTH");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ReportData | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getFinancePeriodReport({ preset, offset });
      if (!res.success || !res.data) {
        toast.error(res.success ? "Relatório indisponível." : res.error);
        return;
      }
      setReport(res.data);
    } finally {
      setLoading(false);
    }
  }, [preset, offset]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const totals = report?.totals;

  return (
    <Card className="border-border bg-white shadow-sm dark:border-border dark:bg-card lg:col-span-2">
      <CardHeader>
        <CardTitle>Relatório por período</CardTitle>
        <CardDescription>
          Entrada bruta, despesas (fixas + variáveis) e total líquido. Escolha o intervalo e navegue entre períodos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Seletor de período */}
        <div className="flex flex-wrap items-center gap-2">
          {FINANCE_PERIOD_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setPreset(p);
                setOffset(0);
              }}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm font-medium transition",
                preset === p
                  ? "bg-clinical shadow-sm"
                  : "bg-muted text-foreground/90 hover:bg-muted dark:bg-muted dark:text-muted-foreground dark:hover:bg-muted",
              )}
            >
              {PRESET_LABEL[p]}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={financeOutlineBtnClass}
            onClick={() => setOffset((o) => o - 1)}
          >
            <ChevronLeft className="h-4 w-4" /> Anterior
          </Button>
          <div className="text-center">
            <p className="text-sm font-semibold">{report?.label ?? "—"}</p>
            {loading && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> atualizando
              </span>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={financeOutlineBtnClass}
            disabled={offset >= 0}
            onClick={() => setOffset((o) => Math.min(0, o + 1))}
          >
            Próximo <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Cartões */}
        {totals && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-clinical/30 bg-clinical/10 p-4 dark:border-clinical/30 dark:bg-clinical/15">
              <p className="text-xs uppercase tracking-wide text-clinical/80 dark:text-clinical/80">
                Entrada bruta
              </p>
              <p className="text-xl font-bold text-clinical dark:text-clinical">
                {formatBrlFromCents(totals.grossIncomeCents)}
              </p>
              <DeltaBadge pct={report.previous.grossDeltaPct} />
            </div>
            <div className="rounded-xl border border-border bg-muted p-4 dark:border-border dark:bg-muted/40">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Despesa fixa</p>
              <p className="text-xl font-bold text-warning">
                {formatBrlFromCents(totals.fixedExpenseCents)}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-muted p-4 dark:border-border dark:bg-muted/40">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Despesa variável</p>
              <p className="text-xl font-bold text-destructive">
                {formatBrlFromCents(totals.variableExpenseCents)}
              </p>
            </div>
            <div
              className={cn(
                "rounded-xl border p-4",
                totals.netCents >= 0
                  ? "border-clinical/30 bg-clinical/10 dark:border-clinical/30 dark:bg-clinical/15"
                  : "border-warning/30 bg-warning/10 dark:border-warning/40 dark:bg-warning/15",
              )}
            >
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Total líquido</p>
              <p
                className={cn(
                  "text-xl font-bold",
                  totals.netCents >= 0
                    ? "text-clinical"
                    : "text-warning",
                )}
              >
                {formatBrlFromCents(totals.netCents)}
              </p>
              <DeltaBadge pct={report.previous.netDeltaPct} />
            </div>
          </div>
        )}

        {report ? <FinancePeriodBreakdown report={report} /> : null}
      </CardContent>
    </Card>
  );
}
