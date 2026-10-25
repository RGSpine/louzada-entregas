"use client";

import Link from "next/link";
import { Wallet } from "lucide-react";
import { formatBrlFromCents } from "@/components/dashboard/finances/finance-format";
import type { AgendaFinanceProjection } from "@/lib/agenda-finance-projection";
import { buildAgendaWeekFinanceLink } from "@/lib/finance/finance-deep-link";
import { cn } from "@/lib/utils";

type Props = {
  projection: AgendaFinanceProjection;
  className?: string;
  compact?: boolean;
  hideHeader?: boolean;
  embedded?: boolean;
  /** yyyy-MM-dd do início da semana (segunda) — deep-link para o extrato */
  weekStartIso?: string | null;
};

export function AgendaFinanceProjectionSummary({
  projection,
  className,
  compact = false,
  hideHeader = false,
  embedded = false,
  weekStartIso = null,
}: Props) {
  const financesHref = weekStartIso
    ? buildAgendaWeekFinanceLink(weekStartIso)
    : "/dashboard/finances?tab=analisar";

  const hasCash =
    projection.scheduledCashCents > 0 ||
    projection.completedCashCents > 0 ||
    projection.scheduledCashCount > 0 ||
    projection.completedCashCount > 0;
  const hasPlan =
    projection.planScheduledCount > 0 || projection.planCompletedCount > 0;

  if (!hasCash && !hasPlan) {
    return (
      <div
        className={cn(
          embedded
            ? "text-xs text-muted-foreground"
            : "rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground",
          className,
        )}
      >
        Sem valores nas marcações desta semana. Defina preço ao criar consultas ou vincule sessões de{" "}
        <Link href={financesHref} className="underline underline-offset-2">
          tratamento/plano
        </Link>
        .
      </div>
    );
  }

  return (
    <div
      className={cn(
        embedded
          ? "text-xs"
          : "rounded-lg border border-border bg-muted/80 px-3 py-2.5 text-sm dark:border-border dark:bg-muted/50",
        className,
      )}
    >
      {!hideHeader && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 font-medium text-foreground">
            <Wallet className="h-4 w-4 shrink-0" aria-hidden />
            Projeção financeira da semana
          </p>
          <Link
            href={financesHref}
            className="text-xs text-primary hover:underline dark:text-primary"
          >
            Ver no financeiro
          </Link>
        </div>
      )}

      <div className={cn("grid gap-2 text-xs", !compact && "sm:grid-cols-2")}>
        {hasCash && (
          <>
            <div>
              <p className="text-muted-foreground">A receber (consultas/retornos agendados)</p>
              <p className="font-semibold text-foreground">
                {formatBrlFromCents(projection.scheduledCashCents)}
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · {projection.scheduledCashCount} marcação
                  {projection.scheduledCashCount === 1 ? "" : "ões"}
                </span>
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Realizado (consultas/retornos)</p>
              <p className="font-semibold text-success">
                {formatBrlFromCents(projection.completedCashCents)}
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · {projection.completedCashCount} marcação
                  {projection.completedCashCount === 1 ? "" : "ões"}
                </span>
              </p>
            </div>
          </>
        )}

        {hasPlan && (
          <div className={cn(hasCash && !compact && "sm:col-span-2")}>
            <p className="text-muted-foreground">Tratamento/plano na agenda</p>
            <p className="font-medium text-foreground">
              {projection.planScheduledCount} agendada
              {projection.planScheduledCount === 1 ? "" : "s"}
              {projection.planScheduledValueCents > 0 && (
                <> ({formatBrlFromCents(projection.planScheduledValueCents)} em sessões)</>
              )}
              {projection.planCompletedCount > 0 && (
                <>
                  {" "}
                  · {projection.planCompletedCount} realizada
                  {projection.planCompletedCount === 1 ? "" : "s"}
                </>
              )}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Valor do pacote costuma já estar no financeiro na venda; aqui é referência por sessão
              agendada.
            </p>
          </div>
        )}
      </div>

      {projection.pendingConfirmationCount > 0 && (
        <p className="mt-2 text-[11px] text-warning">
          {projection.pendingConfirmationCount} marcação(ões) ainda sem confirmar (amarelo).
        </p>
      )}

      {hasCash && (
        <p className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
          Total previsto da semana (consultas + retornos):{" "}
          <span className="font-semibold text-foreground">
            {formatBrlFromCents(projection.weekTotalCashCents)}
          </span>
          {" · "}
          <Link href={financesHref} className="text-primary underline-offset-2 hover:underline">
            abrir extrato desta semana
          </Link>
        </p>
      )}
    </div>
  );
}
