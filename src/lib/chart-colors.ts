import { clinicalCalmColors } from "@/design/tokens";

/** Paleta de séries para gráficos (Recharts, uPlot, etc.) */
export const clinicalCalmChartSeries = [
  clinicalCalmColors.light.primary,
  "#2a2ab8",
  clinicalCalmColors.light.success,
  clinicalCalmColors.light.warning,
  "#a855f7",
] as const;

export type ClinicalCalmChartColors = {
  grid: string;
  axisStroke: string;
  tickFill: string;
  tickLine: string;
  yTickFill: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  tooltipLabel: string;
  labelFill: string;
  primary: string;
  clinical: string;
  success: string;
  series: readonly string[];
};

/** Cores inline para Recharts — derivadas dos tokens Clinical Calm. */
export function getClinicalCalmChartColors(isDark: boolean): ClinicalCalmChartColors {
  const t = isDark ? clinicalCalmColors.dark : clinicalCalmColors.light;
  return {
    grid: t.border,
    axisStroke: t.mutedForeground,
    tickFill: t.mutedForeground,
    tickLine: t.border,
    yTickFill: t.foreground,
    tooltipBg: t.card,
    tooltipBorder: t.border,
    tooltipText: t.foreground,
    tooltipLabel: t.mutedForeground,
    labelFill: t.mutedForeground,
    primary: t.primary,
    clinical: t.clinical,
    success: t.success,
    series: isDark
      ? [
          clinicalCalmColors.dark.primary,
          "#8e90f0",
          clinicalCalmColors.dark.success,
          clinicalCalmColors.dark.warning,
          "#a855f7",
        ]
      : clinicalCalmChartSeries,
  };
}
