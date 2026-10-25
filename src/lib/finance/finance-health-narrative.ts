/**
 * Narrativa determinística de saúde financeira a partir de totais já calculados.
 * A IA não faz aritmética — só esta função formata os centavos.
 */
import type { FinancePeriodReport } from "@/lib/finance/period-report";

function brl(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );
}

export function buildFinanceHealthNarrative(
  report: FinancePeriodReport,
  aiMessage?: string | null,
): string {
  const t = report.totals;
  const parts: string[] = [];
  const ai = aiMessage?.trim();
  if (ai) parts.push(ai);

  parts.push(
    `No período «${report.label}»: bruto ${brl(t.grossIncomeCents)}, despesas fixas ${brl(t.fixedExpenseCents)}, variáveis ${brl(t.variableExpenseCents)}, líquido ${brl(t.netCents)} (${t.transactionCount} lançamento(s)).`,
  );

  if (t.grossIncomeCents === 0 && t.totalExpenseCents === 0) {
    parts.push(
      "Ainda não há movimentos neste intervalo — registre vendas/entradas ou confira se o período está correto.",
    );
  } else if (t.netCents < 0) {
    parts.push(
      "Atenção: o líquido está negativo — as saídas superam as entradas neste período.",
    );
  } else if (t.grossIncomeCents > 0) {
    const marginPct = Math.round((t.netCents / t.grossIncomeCents) * 100);
    if (marginPct >= 40) {
      parts.push(`Margem líquida em torno de ${marginPct}% sobre o bruto — caixa saudável neste recorte.`);
    } else if (marginPct >= 15) {
      parts.push(
        `Margem líquida em torno de ${marginPct}% — razoável; acompanhe fixas e imprevistos.`,
      );
    } else {
      parts.push(
        `Margem líquida em torno de ${marginPct}% — apertada; revise gastos fixos e variáveis.`,
      );
    }
  }

  if (t.fixedExpenseCents > 0 && t.grossIncomeCents > 0) {
    const fixedShare = Math.round((t.fixedExpenseCents / t.grossIncomeCents) * 100);
    if (fixedShare >= 50) {
      parts.push(
        `Gastos fixos representam ~${fixedShare}% do bruto — peso alto na estrutura.`,
      );
    }
  }

  if (report.previous.totals.transactionCount > 0 || report.previous.totals.grossIncomeCents > 0) {
    const d = report.previous.netDeltaPct;
    if (d != null) {
      const dir = d > 0 ? "acima" : d < 0 ? "abaixo" : "igual";
      parts.push(
        `Líquido vs «${report.previous.label}»: ${dir}${d !== 0 ? ` (${d > 0 ? "+" : ""}${d}%)` : ""}.`,
      );
    }
  }

  return parts.join(" ");
}
