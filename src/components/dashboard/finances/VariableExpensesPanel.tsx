"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { FinancialTransactionMethod } from "@prisma/client";
import {
  createFinancialTransaction,
  listFinancialTransactions,
  voidFinancialTransaction,
} from "@/app/actions/clinic-finances";
import { FinanceFormIntakeToolbar } from "@/components/dashboard/finances/FinanceFormIntakeToolbar";
import type { OfficeFinanceExtractionEnvelope } from "@/lib/office-finance-ai-extract";
import { yyyyMmDdToSaoPauloNoon } from "@/lib/finance/portuguese-payment";
import {
  occurredAtInPeriod,
  resolveFinancePeriod,
  type ResolvedFinancePeriod,
} from "@/lib/finance/period";
import { formatBrlFromCents, rawMoneyToCents, todayInput, METHOD_PT } from "./finance-format";
import { inclusiveEndFromExclusiveUtc } from "./finance-period-bounds";
import { financeOutlineBtnClass } from "./finance-outline-btn";
import { ServiceSpaceSelect } from "./ServiceSpaceSelect";

const VARIABLE_VOID_REASON = "Gasto variável excluído pelo profissional.";

type VariableRow = {
  id: string;
  amountCents: number;
  occurredAt: Date;
  method: FinancialTransactionMethod;
  description: string | null;
  category: string | null;
  canVoid: boolean;
};

type VariableMonthWindows = {
  current: ResolvedFinancePeriod;
  previous: ResolvedFinancePeriod;
};

function variableMonthWindows(): VariableMonthWindows {
  return {
    current: resolveFinancePeriod({ preset: "MONTH", offset: 0 }),
    previous: resolveFinancePeriod({ preset: "MONTH", offset: -1 }),
  };
}

/**
 * Gastos variáveis / imprevistos do mês (conserto, aparelho, material…).
 * Lança EXPENSE VARIABLE no caixa — entra no líquido da aba Analisar.
 */
export function VariableExpensesPanel({
  onChanged,
  allowImageUpload = false,
  maxAudioMinutes = 120,
  outlineBtnClass,
}: {
  onChanged?: () => void;
  allowImageUpload?: boolean;
  maxAudioMinutes?: number;
  outlineBtnClass?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [description, setDescription] = useState("");
  const [amountRaw, setAmountRaw] = useState("");
  const [category, setCategory] = useState("");
  const [method, setMethod] = useState<FinancialTransactionMethod>("PIX");
  const [dateStr, setDateStr] = useState(todayInput());
  const [spaceId, setSpaceId] = useState("");
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [rows, setRows] = useState<VariableRow[]>([]);
  const [windows, setWindows] = useState<VariableMonthWindows>(variableMonthWindows);

  const load = useCallback(async () => {
    const next = variableMonthWindows();
    const res = await listFinancialTransactions({
      start: next.previous.startUtc,
      end: inclusiveEndFromExclusiveUtc(next.current.endUtc),
      kind: "EXPENSE",
      expenseNature: "VARIABLE",
    });
    if (res.success && res.data) {
      setWindows(next);
      setRows(
        res.data.map((r) => ({
          id: r.id,
          amountCents: r.amountCents,
          occurredAt: new Date(r.occurredAt),
          method: r.method,
          description: r.description,
          category: r.category,
          canVoid: r.canVoid,
        })),
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setDescription("");
    setAmountRaw("");
    setCategory("");
    setMethod("PIX");
    setDateStr(todayInput());
    setSpaceId("");
  }

  function applyEnvelope(env: OfficeFinanceExtractionEnvelope) {
    env.warnings.forEach((msg) => toast.warning(msg, { duration: 7000 }));
    const kind = env.model.transactionKindGuess;
    if (
      env.model.recordType !== "standalone_transaction" &&
      kind !== "EXPENSE" &&
      env.suggestedStandaloneAmountCents == null
    ) {
      toast.info("Descreva um gasto pontual (ex.: conserto, material, aparelho).");
      return;
    }
    if (kind === "INCOME") {
      toast.info("Isso parece uma entrada. Use Registrar para receitas.");
      return;
    }
    const amount =
      env.suggestedStandaloneAmountCents ??
      (env.model.agreedAmountReais != null
        ? Math.round(env.model.agreedAmountReais * 100)
        : null);
    if (amount != null && amount > 0) {
      setAmountRaw((amount / 100).toFixed(2).replace(".", ","));
    }
    const desc =
      env.model.narrativeSummaryPt?.trim() ||
      env.model.recurringNameGuess?.trim() ||
      env.suggestedPaymentNote ||
      "";
    if (desc) setDescription(desc);
    if (env.model.categoryGuess) setCategory(env.model.categoryGuess);
    if (env.model.paymentMethodGuess) setMethod(env.model.paymentMethodGuess);
    if (env.suggestedOccurredYyyyMmDd) setDateStr(env.suggestedOccurredYyyyMmDd);
    toast.success("Gasto variável sugerido — confira antes de salvar.");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cents = rawMoneyToCents(amountRaw);
    if (cents == null || cents <= 0) {
      toast.error("Informe um valor válido.");
      return;
    }
    if (!description.trim()) {
      toast.error("Descreva o gasto (ex.: conserto do ar-condicionado).");
      return;
    }
    const occurredAt =
      yyyyMmDdToSaoPauloNoon(dateStr) ?? new Date(`${dateStr}T12:00:00-03:00`);

    setBusy(true);
    try {
      const res = await createFinancialTransaction({
        kind: "EXPENSE",
        amountCents: cents,
        occurredAt,
        method,
        description: description.trim(),
        category: category.trim() || "imprevisto",
        expenseNature: "VARIABLE",
        source: "MANUAL",
        ...(spaceId.trim() ? { serviceSpaceId: spaceId.trim() } : {}),
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      setLastSaved(
        `${description.trim()} · ${formatBrlFromCents(cents)} em ${occurredAt.toLocaleDateString("pt-BR")}`,
      );
      toast.success("Gasto variável lançado — vale só neste mês em Analisar.");
      resetForm();
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  async function removeRow(row: VariableRow) {
    const label = row.description?.trim() || "este gasto variável";
    const confirmed = window.confirm(
      `Excluir «${label}»?\n\nEle deixa de descontar do líquido em Analisar. Esta ação não pode ser desfeita.`,
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      const res = await voidFinancialTransaction({
        transactionId: row.id,
        reason: VARIABLE_VOID_REASON,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Gasto variável excluído — saiu da análise.");
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  const currentRows = rows.filter((r) => occurredAtInPeriod(r.occurredAt, windows.current));
  const previousRows = rows.filter((r) => occurredAtInPeriod(r.occurredAt, windows.previous));

  return (
    <Card className="border-border bg-white shadow-sm dark:border-border dark:bg-card">
      <CardHeader>
        <CardTitle>Gastos variáveis / imprevistos</CardTitle>
        <CardDescription>
          Saída pontual com duração de um mês civil. Lançado em 24/09 entra só em setembro;
          em outubro some sozinho da análise mensal. Se precisar corrigir, exclua abaixo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <FinanceFormIntakeToolbar
          target="standalone"
          allowImageUpload={allowImageUpload}
          maxAudioMinutes={maxAudioMinutes}
          disabled={busy}
          outlineBtnClass={outlineBtnClass ?? financeOutlineBtnClass}
          hint="Descreva o imprevisto em áudio/texto ou anexe o comprovante."
          onEnvelope={applyEnvelope}
        />
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          <ServiceSpaceSelect
            id="var-space"
            value={spaceId}
            onChange={setSpaceId}
            label="Espaço deste gasto"
            disabled={busy}
          />
          <div>
            <Label htmlFor="var-desc">O que foi</Label>
            <Textarea
              id="var-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex.: conserto do ar-condicionado / compra de ultrassom"
              disabled={busy}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="var-amount">Valor (R$)</Label>
              <Input
                id="var-amount"
                inputMode="decimal"
                value={amountRaw}
                onChange={(e) => setAmountRaw(e.target.value)}
                placeholder="350,00"
                disabled={busy}
              />
            </div>
            <div>
              <Label htmlFor="var-date">Data</Label>
              <Input
                id="var-date"
                type="date"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                disabled={busy}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="var-cat">Categoria</Label>
              <Input
                id="var-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="imprevisto, equipamento, manutenção…"
                disabled={busy}
              />
            </div>
            <div>
              <Label htmlFor="var-method">Forma de pagamento</Label>
              <select
                id="var-method"
                className="flex h-10 w-full rounded-md border border-border bg-white px-3 text-sm dark:border-border dark:bg-card"
                value={method}
                onChange={(e) => setMethod(e.target.value as FinancialTransactionMethod)}
                disabled={busy}
              >
                {(Object.entries(METHOD_PT) as Array<[FinancialTransactionMethod, string]>).map(
                  ([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ),
                )}
              </select>
            </div>
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? "Salvando…" : "Lançar gasto variável"}
          </Button>
          {lastSaved ? (
            <p className="text-xs text-muted-foreground">Último lançamento: {lastSaved}</p>
          ) : null}
        </form>

        <VariableMonthList
          title={windows.current.label}
          hint="Entra no líquido deste mês."
          rows={currentRows}
          busy={busy}
          onRemove={removeRow}
        />
        <VariableMonthList
          title={windows.previous.label}
          hint="Mês encerrado — não entra mais na análise do mês atual."
          rows={previousRows}
          busy={busy}
          onRemove={removeRow}
          past
        />
      </CardContent>
    </Card>
  );
}

function VariableMonthList({
  title,
  hint,
  rows,
  busy,
  onRemove,
  past = false,
}: {
  title: string;
  hint: string;
  rows: VariableRow[];
  busy: boolean;
  onRemove: (row: VariableRow) => void;
  past?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="text-sm font-medium capitalize">{title}</p>
        {past ? (
          <Badge variant="secondary">Encerrado</Badge>
        ) : (
          <Badge variant="outline">Mês vigente</Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum gasto variável neste mês.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-medium">{row.description?.trim() || "Gasto variável"}</p>
                <p className="text-sm text-warning">
                  {formatBrlFromCents(row.amountCents)} ·{" "}
                  {row.occurredAt.toLocaleDateString("pt-BR")}
                  {row.category ? ` · ${row.category}` : ""} · {METHOD_PT[row.method]}
                </p>
              </div>
              {row.canVoid ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={busy}
                  onClick={() => onRemove(row)}
                >
                  Excluir
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
