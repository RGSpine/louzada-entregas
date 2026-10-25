"use client";

import uPlot from "uplot";
import { getClinicalCalmChartColors } from "@/lib/chart-colors";
import "uplot/dist/uPlot.min.css";
import { useEffect, useRef } from "react";

export type MetricPoint = { x: number; y: number };

const PANEL_HEIGHT = 232;

function toAlignedData(points: MetricPoint[]): uPlot.AlignedData {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return [xs, ys];
}

/**
 * Um gráfico de linha por métrica, com eixo Y próprio e escala automática.
 * Usa [uPlot](https://github.com/leeoniya/uPlot) (MIT) — foco em séries temporais e renderização precisa em canvas.
 */
export function VisualProgressUPlotMetricPanel({
  title,
  points,
  stroke,
  isDark,
}: {
  title: string;
  points: MetricPoint[];
  stroke: string;
  isDark: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || points.length === 0) return;

    const { grid: gridColor, tickFill: axisStroke } = getClinicalCalmChartColors(isDark);
    const gridStroke = isDark ? `${gridColor}a6` : `${gridColor}f2`;

    const data = toAlignedData(points);

    const makeOpts = (width: number): uPlot.Options => ({
      width: Math.max(width, 200),
      height: PANEL_HEIGHT,
      cursor: { drag: { x: false, y: false } },
      legend: { show: false },
      series: [
        {},
        {
          label: title,
          stroke,
          width: 2,
          points: { show: true, size: 5, stroke, fill: stroke },
        },
      ],
      axes: [
        {
          stroke: axisStroke,
          grid: { show: true, stroke: gridStroke, width: 1 },
          ticks: { stroke: axisStroke },
          values: (_u, splits) =>
            splits.map((v) =>
              new Date(v * 1000).toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                year: "2-digit",
              })
            ),
        },
        {
          stroke: axisStroke,
          grid: { show: true, stroke: gridStroke, width: 1 },
          ticks: { stroke: axisStroke },
          size: 52,
          values: (_u, splits) =>
            splits.map((v) =>
              new Intl.NumberFormat("pt-BR", {
                maximumFractionDigits: 4,
              }).format(v)
            ),
        },
      ],
      scales: {
        x: { time: true },
        y: {
          auto: true,
          range: (_u, min, max) => {
            if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
            if (min === max) {
              const d = Math.abs(min) * 0.1 || 1;
              return [min - d, max + d];
            }
            const pad = (max - min) * 0.08 || 1;
            return [min - pad, max + pad];
          },
        },
      },
    });

    const initialW = host.clientWidth || 400;
    plotRef.current?.destroy();
    plotRef.current = new uPlot(makeOpts(initialW), data, host);

    const ro = new ResizeObserver(() => {
      const p = plotRef.current;
      if (!p || !host) return;
      const nw = host.clientWidth;
      if (nw > 0) p.setSize({ width: nw, height: PANEL_HEIGHT });
    });
    ro.observe(host);

    requestAnimationFrame(() => {
      const p = plotRef.current;
      if (!p || !host) return;
      const nw = host.clientWidth;
      if (nw > 0) p.setSize({ width: nw, height: PANEL_HEIGHT });
    });

    return () => {
      ro.disconnect();
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  }, [title, points, stroke, isDark]);

  if (points.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-muted/50 dark:bg-card/40 p-2 min-w-0">
      <p
        className="text-xs font-medium text-foreground/90 dark:text-foreground mb-1 px-1 truncate"
        title={title}
      >
        {title}
      </p>
      <div ref={hostRef} className="w-full min-w-0" />
    </div>
  );
}
