"use client";

import { useLayoutEffect, useRef, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  Tooltip,
  LabelList,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShareButton } from "@/components/ui/ShareButton";
import { Stethoscope, TrendingUp, Tag } from "lucide-react";
import { useTheme } from "@/components/theme/ClinicalThemeProvider";
import { getClinicalCalmChartColors } from "@/lib/chart-colors";

const CHART_H = 256;
const MIN_W = 280;

interface TagCount {
  tag: string;
  count: number;
}

interface ClinicalInsightsProps {
  topTags: TagCount[];
  totalTags: number;
  mostFrequentTag: string | null;
  /** Quantidade de tags no mês civil atual (para o rótulo de foco). */
  monthTagCount?: number;
  shareUrl?: string;
}

export function ClinicalInsights({
  topTags,
  totalTags,
  mostFrequentTag,
  monthTagCount = 0,
  shareUrl,
}: ClinicalInsightsProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const wrapRef = useRef<HTMLDivElement>(null);
  const [chartW, setChartW] = useState(0);

  const chartColors = getClinicalCalmChartColors(isDark);

  useLayoutEffect(() => {
    if (topTags.length === 0) return;
    const el = wrapRef.current;
    if (!el) return;
    const apply = (w: number) => {
      const safe = Math.max(MIN_W, Math.floor(w));
      setChartW(safe);
    };
    apply(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      apply(cr?.width ?? 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [topTags.length]);

  if (topTags.length === 0) {
    return (
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <Stethoscope className="h-5 w-5 text-clinical" />
            Perfil Clínico
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12">
            <Tag className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-2">
              Ainda não há dados clínicos suficientes
            </p>
            <p className="text-sm text-muted-foreground">
              Continue registrando evoluções para visualizar seu perfil clínico
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const chartData = topTags.map((item, index) => ({
    name: item.tag,
    value: item.count,
    fill: chartColors.series[index % chartColors.series.length] ?? chartColors.clinical,
  }));
  const maxValue = Math.max(...topTags.map((t) => t.count));

  const shareTitle = "Perfil Clínico - Louzada Entregas";
  const shareText = [
    mostFrequentTag && `Foco principal: ${mostFrequentTag}`,
    topTags.length > 0 &&
      `Top áreas: ${topTags
        .slice(0, 5)
        .map((t) => `${t.tag} (${t.count})`)
        .join(", ")}`,
    `Total no perfil: ${totalTags}`,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-foreground flex items-center gap-2">
            <Stethoscope className="h-5 w-5 text-clinical" />
            Perfil Clínico
          </CardTitle>
          <ShareButton title={shareTitle} url={shareUrl} text={shareText} />
        </div>
      </CardHeader>
      <CardContent>
        {mostFrequentTag && (
          <div className="mb-6 p-4 bg-gradient-to-r from-clinical/20 to-clinical/10 rounded-lg border border-clinical/30">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-clinical/20 rounded-lg">
                <TrendingUp className="h-5 w-5 text-clinical" />
              </div>
              <div>
                <p className="text-sm text-clinical">
                  {monthTagCount > 0
                    ? "Seu foco principal este mês"
                    : "Seu foco principal de atuação"}
                </p>
                <p className="text-xl font-bold text-foreground">
                  {mostFrequentTag}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="mb-4">
          <h4 className="text-sm font-medium text-muted-foreground mb-4">
            Top 5 - Áreas de Atuação
          </h4>
          <div
            ref={wrapRef}
            className="w-full min-w-0 shrink-0 overflow-hidden rounded-md border border-border/80 dark:border-border/80 bg-muted/50 dark:bg-muted/30"
            style={{ height: CHART_H }}
          >
            {chartW > 0 ? (
              <BarChart
                width={chartW}
                height={CHART_H}
                layout="vertical"
                data={chartData}
                margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
              >
                <XAxis
                  type="number"
                  stroke={chartColors.axisStroke}
                  tick={{ fill: chartColors.tickFill, fontSize: 12 }}
                  tickLine={{ stroke: chartColors.tickLine }}
                  axisLine={{ stroke: chartColors.grid }}
                  domain={[
                    0,
                    maxValue + Math.max(1, Math.ceil(maxValue * 0.1)),
                  ]}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  stroke={chartColors.axisStroke}
                  tick={{ fill: chartColors.yTickFill, fontSize: 13 }}
                  tickLine={false}
                  axisLine={false}
                  width={120}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: chartColors.tooltipBg,
                    border: `1px solid ${chartColors.tooltipBorder}`,
                    borderRadius: "8px",
                    color: chartColors.tooltipText,
                  }}
                  labelStyle={{
                    color: chartColors.tooltipLabel,
                    fontWeight: "bold",
                  }}
                  formatter={(value) => [`${value} atendimentos`, "Quantidade"]}
                />
                <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={32}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                  <LabelList
                    dataKey="value"
                    position="right"
                    fill={chartColors.labelFill}
                    fontSize={12}
                    fontWeight="bold"
                  />
                </Bar>
              </BarChart>
            ) : (
              <div
                className="h-full w-full animate-pulse bg-muted/60 dark:bg-muted/40"
                aria-hidden
              />
            )}
          </div>
        </div>

        <div className="flex items-center justify-between p-3 bg-muted dark:bg-muted/50 rounded-lg">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              Total de atendimentos no perfil
            </span>
          </div>
          <span className="text-lg font-semibold text-foreground">
            {totalTags}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

