"use client";

import { useLayoutEffect, useRef, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTheme } from "@/components/theme/ClinicalThemeProvider";
import type { FinancePeriodReport } from "@/app/actions/clinic-finances";
import { clinicalCalmColors } from "@/design/tokens";
import { getClinicalCalmChartColors } from "@/lib/chart-colors";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { formatBrlFromCents, METHOD_PT } from "./finance-format";

const CHART_H = 320;
const CHART_MIN_W = 280;

type MoneyRow = { incomeCents: number; expenseCents: number };

function centsLabel(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return "—";
  return formatBrlFromCents(n);
}

function formatAxisCents(cents: number): string {
  const reais = cents / 100;
  const compact = Math.abs(reais) >= 1000;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 0,
  }).format(reais);
}

function sumMoney(rows: MoneyRow[]): MoneyRow {
  let incomeCents = 0;
  let expenseCents = 0;
  for (const row of rows) {
    incomeCents += row.incomeCents;
    expenseCents += row.expenseCents;
  }
  return { incomeCents, expenseCents };
}

function MoneyCells({ incomeCents, expenseCents }: MoneyRow) {
  return (
    <>
      <td className="px-3 py-2 text-right tabular-nums text-clinical">
        {formatBrlFromCents(incomeCents)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-destructive">
        {formatBrlFromCents(expenseCents)}
      </td>
    </>
  );
}

export function FinancePeriodBreakdown({ report }: { report: FinancePeriodReport }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const chartColors = getClinicalCalmChartColors(isDark);
  const reduceMotion = useReducedMotion();
  const expenseColor = isDark
    ? clinicalCalmColors.dark.destructive
    : clinicalCalmColors.light.destructive;

  const wrapRef = useRef<HTMLDivElement>(null);
  const [chartW, setChartW] = useState(0);

  const hasChart = report.timeseries.length > 0;
  const categories = report.byCategory;
  const methods = report.byMethod.filter((row) => row.incomeCents > 0 || row.expenseCents > 0);
  const patients = report.topPatients;
  const hasCategory = categories.length > 0;
  const hasMethod = methods.length > 0;
  const hasPatients = patients.length > 0;

  useLayoutEffect(() => {
    if (!hasChart) return;
    const el = wrapRef.current;
    if (!el) return;
    const apply = (w: number) => {
      const safe = Math.max(CHART_MIN_W, Math.floor(w));
      setChartW(safe);
    };
    apply(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      apply(entries[0]?.contentRect.width ?? 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasChart, report.timeseries.length]);

  if (!hasChart && !hasCategory && !hasMethod && !hasPatients) return null;

  const categoryTotals = sumMoney(categories);
  const methodTotals = sumMoney(methods);
  const listedPatientIncome = patients.reduce((sum, row) => sum + row.incomeCents, 0);
  const incomeOutsideList = report.totals.grossIncomeCents - listedPatientIncome;
  const tickInterval =
    report.timeseries.length > 12 ? Math.ceil(report.timeseries.length / 8) - 1 : 0;
  const tiltLabels = report.timeseries.length > 16;

  return (
    <div className="space-y-4">
      {hasChart ? (
        <figure className="rounded-xl border border-border p-4">
          <figcaption className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Evolução no período
          </figcaption>
          <div ref={wrapRef} className="w-full min-w-0 overflow-x-auto" style={{ minHeight: CHART_H }}>
            {chartW > 0 ? (
              <ComposedChart
                width={chartW}
                height={CHART_H}
                data={report.timeseries}
                margin={{ top: 8, right: 8, left: 0, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                <XAxis
                  dataKey="label"
                  stroke={chartColors.axisStroke}
                  tick={{ fill: chartColors.tickFill, fontSize: 11 }}
                  tickLine={{ stroke: chartColors.tickLine }}
                  interval={tickInterval}
                  angle={tiltLabels ? -35 : 0}
                  textAnchor={tiltLabels ? "end" : "middle"}
                  height={tiltLabels ? 48 : 30}
                />
                <YAxis
                  stroke={chartColors.axisStroke}
                  tick={{ fill: chartColors.tickFill, fontSize: 11 }}
                  tickLine={{ stroke: chartColors.tickLine }}
                  tickFormatter={formatAxisCents}
                  width={72}
                />
                <Tooltip
                  formatter={(value) => centsLabel(value)}
                  contentStyle={{
                    backgroundColor: chartColors.tooltipBg,
                    border: `1px solid ${chartColors.tooltipBorder}`,
                    borderRadius: "8px",
                    color: chartColors.tooltipText,
                  }}
                  labelStyle={{ color: chartColors.tooltipLabel }}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: chartColors.tickFill }} />
                <Bar
                  dataKey="incomeCents"
                  name="Entrada"
                  fill={chartColors.clinical}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={!reduceMotion}
                />
                <Bar
                  dataKey="expenseCents"
                  name="Despesa"
                  fill={expenseColor}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={!reduceMotion}
                />
                <Line
                  type="monotone"
                  dataKey="netCents"
                  name="Líquido"
                  stroke={chartColors.primary}
                  strokeWidth={2}
                  dot={{ r: 3, fill: chartColors.primary }}
                  isAnimationActive={!reduceMotion}
                />
              </ComposedChart>
            ) : (
              <div
                className="w-full animate-pulse rounded-md bg-muted/60 dark:bg-muted/40"
                style={{ height: CHART_H }}
                aria-hidden
              />
            )}
          </div>
        </figure>
      ) : null}

      {hasCategory || hasMethod ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {hasCategory ? (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[18rem] text-sm">
                <caption className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Por categoria
                </caption>
                <thead>
                  <tr className="border-t border-border text-muted-foreground">
                    <th scope="col" className="px-3 py-2 text-left font-medium">
                      Categoria
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Entrada
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Despesa
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((row) => (
                    <tr key={row.category} className="border-t border-border">
                      <th scope="row" className="px-3 py-2 text-left font-normal text-foreground">
                        {row.category}
                      </th>
                      <MoneyCells incomeCents={row.incomeCents} expenseCents={row.expenseCents} />
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border font-medium">
                    <th scope="row" className="px-3 py-2 text-left">
                      Total do período
                    </th>
                    <MoneyCells
                      incomeCents={categoryTotals.incomeCents}
                      expenseCents={categoryTotals.expenseCents}
                    />
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : null}

          {hasMethod ? (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[18rem] text-sm">
                <caption className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Por forma de pagamento
                </caption>
                <thead>
                  <tr className="border-t border-border text-muted-foreground">
                    <th scope="col" className="px-3 py-2 text-left font-medium">
                      Forma
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Entrada
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Despesa
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {methods.map((row) => (
                    <tr key={row.method} className="border-t border-border">
                      <th scope="row" className="px-3 py-2 text-left font-normal text-foreground">
                        {METHOD_PT[row.method]}
                      </th>
                      <MoneyCells incomeCents={row.incomeCents} expenseCents={row.expenseCents} />
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border font-medium">
                    <th scope="row" className="px-3 py-2 text-left">
                      Total do período
                    </th>
                    <MoneyCells
                      incomeCents={methodTotals.incomeCents}
                      expenseCents={methodTotals.expenseCents}
                    />
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      {hasPatients ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[16rem] text-sm">
            <caption className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Clientes que mais geraram receita
            </caption>
            <thead>
              <tr className="border-t border-border text-muted-foreground">
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  Cliente
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Receita
                </th>
              </tr>
            </thead>
            <tbody>
              {patients.map((row) => (
                <tr key={row.patientId} className="border-t border-border">
                  <th scope="row" className="px-3 py-2 text-left font-normal text-foreground">
                    {row.name}
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums text-clinical">
                    {formatBrlFromCents(row.incomeCents)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-medium">
                <th scope="row" className="px-3 py-2 text-left">
                  Total listado
                </th>
                <td className="px-3 py-2 text-right tabular-nums text-clinical">
                  {formatBrlFromCents(listedPatientIncome)}
                </td>
              </tr>
            </tfoot>
          </table>
          {incomeOutsideList > 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {formatBrlFromCents(incomeOutsideList)} da entrada bruta ficou fora desta lista: sem
              paciente vinculado ou além dos cinco primeiros.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
