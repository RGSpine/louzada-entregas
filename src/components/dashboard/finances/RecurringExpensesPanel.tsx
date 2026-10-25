"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  deleteRecurringExpense,
  listRecurringExpenses,
  upsertRecurringExpense,
  setRecurringExpenseActive,
} from "@/app/actions/clinic-finances";
import type { FinancialTransactionMethod, RecurringExpenseFrequency } from "@prisma/client";
import { FinanceFormIntakeToolbar } from "@/components/dashboard/finances/FinanceFormIntakeToolbar";
import type { OfficeFinanceExtractionEnvelope } from "@/lib/office-finance-ai-extract";
import { formatBrlFromCents, rawMoneyToCents, METHOD_PT } from "./finance-format";
import { financeOutlineBtnClass } from "./finance-outline-btn";
import { ServiceSpaceSelect } from "./ServiceSpaceSelect";

type RecurringRow = {
  id: string;
  name: string;
  amountCents: number;
  category: string | null;
  method: FinancialTransactionMethod;
  frequency: RecurringExpenseFrequency;
  anchorDay: number;
  active: boolean;
  notes: string | null;
  serviceSpaceId: string | null;
};

const FREQUENCY_PT: Record<RecurringExpenseFrequency, string> = {
  WEEKLY: "Semanal",
  MONTHLY: "Mensal",
  YEARLY: "Anual",
};

export function RecurringExpensesPanel({
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
  const [rows, setRows] = useState<RecurringRow[]>([]);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [amountRaw, setAmountRaw] = useState("");
  const [category, setCategory] = useState("");
  const [frequency, setFrequency] = useState<RecurringExpenseFrequency>("MONTHLY");
  const [anchorDay, setAnchorDay] = useState("1");
  const [method, setMethod] = useState<FinancialTransactionMethod>("OTHER");
  const [spaceId, setSpaceId] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await listRecurringExpenses();
    if (res.success && res.data) setRows(res.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setEditingId(null);
    setName("");
    setAmountRaw("");
    setCategory("");
    setFrequency("MONTHLY");
    setAnchorDay("1");
    setMethod("OTHER");
    setSpaceId("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cents = rawMoneyToCents(amountRaw);
    if (cents === null || cents <= 0) {
      toast.error("Valor da despesa inválido.");
      return;
    }
    setBusy(true);
    try {
      const res = await upsertRecurringExpense({
        ...(editingId ? { id: editingId } : {}),
        name,
        amountCents: cents,
        category: category || undefined,
        frequency,
        anchorDay: Number(anchorDay) || 1,
        method,
        serviceSpaceId: spaceId.trim() || null,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success(editingId ? "Despesa fixa atualizada." : "Despesa fixa salva.");
      resetForm();
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  function startEdit(row: RecurringRow) {
    setEditingId(row.id);
    setName(row.name);
    setAmountRaw((row.amountCents / 100).toFixed(2).replace(".", ","));
    setCategory(row.category ?? "");
    setFrequency(row.frequency);
    setAnchorDay(String(row.anchorDay));
    setMethod(row.method);
    setSpaceId(row.serviceSpaceId ?? "");
  }

  async function toggleActive(row: RecurringRow) {
    setBusy(true);
    try {
      const res = await setRecurringExpenseActive({ id: row.id, active: !row.active });
      if (!res.success) toast.error(res.error);
      else {
        toast.success(
          row.active
            ? "Despesa desativada. Este mês e os próximos deixam de entrar em Analisar."
            : "Despesa fixa reativada.",
        );
        await load();
        onChanged?.();
      }
    } finally {
      setBusy(false);
    }
  }

  async function removeExpense(row: RecurringRow) {
    const confirmed = window.confirm(
      `Excluir «${row.name}» de vez?\n\nOs lançamentos automáticos deste gasto saem de Analisar. Esta ação não pode ser desfeita.`,
    );
    if (!confirmed) return;

    setBusy(true);
    try {
      const res = await deleteRecurringExpense({ id: row.id });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Gasto fixo excluído e retirado do caixa.");
      if (editingId === row.id) resetForm();
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  function applyRecurringEnvelope(env: OfficeFinanceExtractionEnvelope) {
    env.warnings.forEach((msg) => toast.warning(msg, { duration: 7000 }));
    const rec = env.suggestedRecurring;
    if (!rec) {
      toast.info("Não foi possível extrair gasto fixo — tente descrever aluguel, valor mensal e dia de vencimento.");
      return;
    }
    setName(rec.name);
    if (rec.amountCents != null && rec.amountCents > 0) {
      setAmountRaw((rec.amountCents / 100).toFixed(2).replace(".", ","));
    }
    if (rec.category) setCategory(rec.category);
    setFrequency(rec.frequency);
    setAnchorDay(String(rec.anchorDay));
    setMethod(rec.method);
    toast.success("Gasto fixo sugerido pela IA — confira antes de salvar.");
  }

  const anchorLabel = frequency === "WEEKLY" ? "Dia da semana (1=seg … 7=dom)" : "Dia do mês (1–28)";

  return (
    <Card className="border-border bg-white shadow-sm dark:border-border dark:bg-card">
      <CardHeader>
        <CardTitle>Gastos fixos</CardTitle>
        <CardDescription>
          Despesas recorrentes (aluguel, software, contador…). Ao salvar, o lançamento do mês
          atual entra no caixa. Desativar estorna este período e os próximos; Excluir remove o
          cadastro e tira o valor de Analisar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <FinanceFormIntakeToolbar
          target="recurring"
          allowImageUpload={allowImageUpload}
          maxAudioMinutes={maxAudioMinutes}
          disabled={busy}
          outlineBtnClass={outlineBtnClass}
          hint="Descreva ou fotografe boleto/contrato de aluguel, software etc."
          onEnvelope={applyRecurringEnvelope}
        />
        <form onSubmit={handleSubmit} className="space-y-3">
          <ServiceSpaceSelect
            id="rec-space"
            value={spaceId}
            onChange={setSpaceId}
            label="Espaço desta despesa"
            disabled={busy}
          />
          <div>
            <Label htmlFor="rec-name">Nome</Label>
            <Input id="rec-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Aluguel da sala" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="rec-amount">Valor (R$)</Label>
              <Input
                id="rec-amount"
                inputMode="decimal"
                value={amountRaw}
                onChange={(e) => setAmountRaw(e.target.value)}
                placeholder="1.200,00"
              />
            </div>
            <div>
              <Label htmlFor="rec-cat">Categoria</Label>
              <Input id="rec-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="aluguel" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="rec-freq">Frequência</Label>
              <select
                id="rec-freq"
                className="flex h-10 w-full rounded-md border border-border bg-white px-3 text-sm dark:border-border dark:bg-card"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as RecurringExpenseFrequency)}
              >
                {(Object.entries(FREQUENCY_PT) as Array<[RecurringExpenseFrequency, string]>).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="rec-anchor">{anchorLabel}</Label>
              <Input
                id="rec-anchor"
                type="number"
                min={1}
                max={frequency === "WEEKLY" ? 7 : 28}
                value={anchorDay}
                onChange={(e) => setAnchorDay(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="rec-method">Forma de pagamento</Label>
            <select
              id="rec-method"
              className="flex h-10 w-full rounded-md border border-border bg-white px-3 text-sm dark:border-border dark:bg-card"
              value={method}
              onChange={(e) => setMethod(e.target.value as FinancialTransactionMethod)}
            >
              {(Object.entries(METHOD_PT) as Array<[FinancialTransactionMethod, string]>).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {editingId ? "Salvar alterações" : "Salvar gasto fixo"}
            </Button>
            {editingId && (
              <Button type="button" variant="ghost" className="text-foreground/90 dark:text-foreground" onClick={resetForm}>
                Cancelar
              </Button>
            )}
          </div>
        </form>

        <ul className="space-y-2">
          {rows.length === 0 ? (
            <li className="text-sm text-muted-foreground">Nenhum gasto fixo salvo.</li>
          ) : (
            rows.map((row) => (
              <li
                key={row.id}
                className={cn(
                  "flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between",
                  row.active
                    ? "border-border"
                    : "border-border bg-muted opacity-75 dark:border-border dark:bg-card/70",
                )}
              >
                <div>
                  <p className="font-medium">
                    {row.name}{" "}
                    {!row.active && (
                      <Badge variant="secondary" className="ml-2">
                        Inativo
                      </Badge>
                    )}
                  </p>
                  <p className="text-sm text-warning">
                    {formatBrlFromCents(row.amountCents)} · {FREQUENCY_PT[row.frequency]}
                    {row.category ? ` · ${row.category}` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className={outlineBtnClass ?? financeOutlineBtnClass}
                    onClick={() => startEdit(row)}
                  >
                    Editar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className={outlineBtnClass ?? financeOutlineBtnClass}
                    onClick={() => toggleActive(row)}
                    disabled={busy}
                  >
                    {row.active ? "Desativar" : "Reativar"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => void removeExpense(row)}
                    disabled={busy}
                  >
                    Excluir
                  </Button>
                </div>
              </li>
            ))
          )}
        </ul>
      </CardContent>
    </Card>
  );
}
