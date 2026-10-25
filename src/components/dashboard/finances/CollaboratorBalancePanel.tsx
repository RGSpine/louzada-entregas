"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  getCollaboratorBalanceReport,
  recordCollaboratorPayout,
  recordCollaboratorPayoutBatch,
  setIntraUserCommissionRate,
  voidCollaboratorPayout,
} from "@/app/actions/clinic-finances";
import type { FinancialTransactionMethod } from "@prisma/client";
import {
  bpsToPercentDisplay,
  percentInputToBps,
  type CollaboratorBalanceLine,
  type CollaboratorPayoutPreset,
} from "@/lib/finance/collaborator-balance";
import { formatBrlFromCents, rawMoneyToCents, METHOD_PT } from "./finance-format";
import { financeOutlineBtnClass } from "./finance-outline-btn";

const PRESET_LABEL: Record<CollaboratorPayoutPreset, string> = {
  WEEK: "Semana",
  FORTNIGHT: "Quinzena",
  MONTH: "Mês",
};

type ReportShape = {
  period: { label: string; periodKey: string; anchorIso: string };
  lines: CollaboratorBalanceLine[];
  totals: {
    grossIncomeCents: number;
    baseCents: number;
    commissionDueCents: number;
    paidCents: number;
    balanceCents: number;
    attendanceCount: number;
    unassignedAttendanceCount: number;
  };
};

/**
 * Analisar → Balanço dos colaboradores (ADMIN · Consultório/Clínica).
 * Cabeçalho Caixa / Produção / A pagar · linhas limpas · drill-down · pagar saldo.
 */
export function CollaboratorBalancePanel({
  reloadKey = 0,
  onDueChange,
}: {
  reloadKey?: number;
  /** Notifica o pai (badge da aba) quando o saldo a pagar muda. */
  onDueChange?: (balanceCents: number) => void;
}) {
  const [preset, setPreset] = useState<CollaboratorPayoutPreset>("MONTH");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ReportShape | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [payAllBusy, setPayAllBusy] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingCommissionId, setEditingCommissionId] = useState<string | null>(null);
  const [commissionDraft, setCommissionDraft] = useState("");
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payoutRaw, setPayoutRaw] = useState("");
  const [payoutMethod, setPayoutMethod] = useState<FinancialTransactionMethod>("PIX");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getCollaboratorBalanceReport({ preset, offset });
      if (!res.success) {
        toast.error(res.error);
        setReport(null);
        onDueChange?.(0);
        return;
      }
      if (!res.data?.enabled || !res.data.report) {
        setReport(null);
        onDueChange?.(0);
        return;
      }
      const r = res.data.report;
      setReport({
        period: r.period,
        lines: r.lines,
        totals: r.totals,
      });
      onDueChange?.(r.totals.balanceCents);
    } finally {
      setLoading(false);
    }
  }, [preset, offset, onDueChange]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  function openCommissionEdit(line: CollaboratorBalanceLine) {
    setEditingCommissionId(line.intraUserId);
    setCommissionDraft(bpsToPercentDisplay(line.commissionRateBps));
    setPayingId(null);
  }

  async function saveCommission(line: CollaboratorBalanceLine) {
    const bps = percentInputToBps(commissionDraft);
    if (bps === null) {
      toast.error("Informe uma comissão entre 0 e 100%.");
      return;
    }
    setBusyId(line.intraUserId);
    try {
      const res = await setIntraUserCommissionRate({
        intraUserId: line.intraUserId,
        commissionRateBps: bps,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success(`Comissão de ${line.name}: ${bpsToPercentDisplay(bps)}%.`);
      setEditingCommissionId(null);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  function openPay(line: CollaboratorBalanceLine) {
    setPayingId(line.intraUserId);
    setPayoutRaw(
      line.balanceCents > 0
        ? (line.balanceCents / 100).toFixed(2).replace(".", ",")
        : "",
    );
    setEditingCommissionId(null);
  }

  async function confirmPay(line: CollaboratorBalanceLine) {
    const cents = rawMoneyToCents(payoutRaw);
    if (cents == null || cents <= 0) {
      toast.error("Informe o valor do repasse.");
      return;
    }
    if (cents > line.balanceCents) {
      toast.error("Valor acima do que há a pagar neste período.");
      return;
    }
    const confirmed = window.confirm(
      `Repassar ${formatBrlFromCents(cents)} para ${line.name}?\n\nVira despesa no caixa ligada a este profissional.`,
    );
    if (!confirmed) return;

    setBusyId(line.intraUserId);
    try {
      const res = await recordCollaboratorPayout({
        intraUserId: line.intraUserId,
        amountCents: cents,
        method: payoutMethod,
        preset,
        offset,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `Repasse ok. Ainda a pagar: ${formatBrlFromCents(res.data?.balanceAfterCents ?? 0)}.`,
      );
      setPayingId(null);
      setPayoutRaw("");
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function payAllDue() {
    if (!report || report.totals.balanceCents <= 0) return;
    const dueCount = report.lines.filter((l) => l.balanceCents > 0).length;
    const confirmed = window.confirm(
      `Pagar o saldo de ${dueCount} colaborador(es) — total ${formatBrlFromCents(report.totals.balanceCents)} via ${METHOD_PT[payoutMethod]}?\n\nCada um recebe exatamente o que falta neste período.`,
    );
    if (!confirmed) return;
    setPayAllBusy(true);
    try {
      const res = await recordCollaboratorPayoutBatch({
        method: payoutMethod,
        preset,
        offset,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `Repasse em lote: ${res.data?.paidCount ?? 0} pagamento(s), ${formatBrlFromCents(res.data?.totalCents ?? 0)}.`,
      );
      await load();
    } finally {
      setPayAllBusy(false);
    }
  }

  async function voidPayout(payoutId: string, name: string, amountCents: number) {
    const confirmed = window.confirm(
      `Estornar repasse de ${formatBrlFromCents(amountCents)} (${name})?\n\nO valor volta ao saldo a pagar e a despesa some do caixa.`,
    );
    if (!confirmed) return;
    setBusyId(payoutId);
    try {
      const res = await voidCollaboratorPayout({
        payoutId,
        reason: "Repasse estornado pelo administrador.",
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Repasse estornado.");
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="border-border bg-white shadow-sm dark:border-border dark:bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Balanço dos colaboradores</CardTitle>
        <CardDescription>
          Quanto entrou no caixa, quanto cada profissional produziu e quanto falta
          repassar. Comissão = % × valor das sessões atendidas no período.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(PRESET_LABEL) as CollaboratorPayoutPreset[]).map((p) => (
            <Button
              key={p}
              type="button"
              size="sm"
              variant={preset === p ? "default" : "outline"}
              className={preset === p ? undefined : financeOutlineBtnClass}
              onClick={() => {
                setPreset(p);
                setOffset(0);
              }}
            >
              {PRESET_LABEL[p]}
            </Button>
          ))}
          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Período anterior"
              onClick={() => setOffset((o) => o - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[10rem] text-center text-sm font-medium capitalize">
              {report?.period.label ?? "—"}
            </span>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Período seguinte"
              onClick={() => setOffset((o) => o + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {loading && !report ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando balanço…
          </div>
        ) : !report ? (
          <p className="text-sm text-muted-foreground">
            Disponível apenas em Consultório/Clínica com perfil administrador.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <SummaryTile
                label="Caixa (receita)"
                hint="Entradas do período"
                value={formatBrlFromCents(report.totals.grossIncomeCents)}
              />
              <SummaryTile
                label="Produção da equipe"
                hint={`${report.totals.attendanceCount} atendimento(s)`}
                value={formatBrlFromCents(report.totals.baseCents)}
              />
              <SummaryTile
                label="A pagar"
                hint={
                  report.totals.paidCents > 0
                    ? `Já repassado ${formatBrlFromCents(report.totals.paidCents)}`
                    : "Saldo de comissões"
                }
                value={formatBrlFromCents(report.totals.balanceCents)}
                emphasize
              />
            </div>

            {report.totals.unassignedAttendanceCount > 0 ? (
              <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
                {report.totals.unassignedAttendanceCount} atendimento(s) sem profissional
                atribuído — não entram no cálculo de ninguém. Confira evoluções/agenda.
              </p>
            ) : null}

            <p className="text-xs text-muted-foreground">
              Comissão devida no período:{" "}
              {formatBrlFromCents(report.totals.commissionDueCents)}.
            </p>

            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[10rem]">
                <Label htmlFor="payout-method-global">Forma do repasse</Label>
                <select
                  id="payout-method-global"
                  className="flex h-10 w-full rounded-md border border-border bg-white px-3 text-sm dark:border-border dark:bg-card"
                  value={payoutMethod}
                  onChange={(e) =>
                    setPayoutMethod(e.target.value as FinancialTransactionMethod)
                  }
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
              {report.totals.balanceCents > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={payAllBusy || loading}
                  onClick={() => void payAllDue()}
                >
                  {payAllBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    `Pagar todos (${formatBrlFromCents(report.totals.balanceCents)})`
                  )}
                </Button>
              ) : null}
            </div>

            <ul className="space-y-2">
              {report.lines.map((line) => {
                const open = expandedId === line.intraUserId;
                const editing = editingCommissionId === line.intraUserId;
                const paying = payingId === line.intraUserId;
                return (
                  <li
                    key={line.intraUserId}
                    className="rounded-lg border border-border px-3 py-2.5"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        onClick={() =>
                          setExpandedId(open ? null : line.intraUserId)
                        }
                        aria-expanded={open}
                      >
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                            open && "rotate-180",
                          )}
                        />
                        <span
                          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: line.color }}
                          aria-hidden
                        />
                        <span className="truncate font-medium">{line.name}</span>
                        <Badge variant="outline" className="font-normal">
                          {bpsToPercentDisplay(line.commissionRateBps)}%
                        </Badge>
                        <span className="hidden text-xs text-muted-foreground sm:inline">
                          {line.attendanceCount} atend. · produção{" "}
                          {formatBrlFromCents(line.baseCents)}
                        </span>
                      </button>

                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-muted-foreground">
                          Comissão{" "}
                          <span className="font-medium text-foreground">
                            {formatBrlFromCents(line.commissionDueCents)}
                          </span>
                        </span>
                        <span className="font-medium text-warning">
                          A pagar {formatBrlFromCents(line.balanceCents)}
                        </span>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          aria-label={`Alterar comissão de ${line.name}`}
                          disabled={busyId === line.intraUserId}
                          onClick={() => openCommissionEdit(line)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {line.balanceCents > 0 ? (
                          <Button
                            type="button"
                            size="sm"
                            className="h-8 gap-1"
                            disabled={busyId === line.intraUserId}
                            onClick={() => openPay(line)}
                          >
                            <Wallet className="h-3.5 w-3.5" />
                            Pagar saldo
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    {editing ? (
                      <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
                        <div className="w-28">
                          <Label htmlFor={`comm-${line.intraUserId}`}>Comissão %</Label>
                          <Input
                            id={`comm-${line.intraUserId}`}
                            inputMode="decimal"
                            value={commissionDraft}
                            onChange={(e) => setCommissionDraft(e.target.value)}
                            disabled={busyId === line.intraUserId}
                            autoFocus
                          />
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          disabled={busyId === line.intraUserId}
                          onClick={() => void saveCommission(line)}
                        >
                          Salvar
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingCommissionId(null)}
                        >
                          Cancelar
                        </Button>
                      </div>
                    ) : null}

                    {paying ? (
                      <div className="mt-3 space-y-2 border-t border-border pt-3">
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div>
                            <Label htmlFor={`pay-${line.intraUserId}`}>Valor (R$)</Label>
                            <Input
                              id={`pay-${line.intraUserId}`}
                              inputMode="decimal"
                              value={payoutRaw}
                              onChange={(e) => setPayoutRaw(e.target.value)}
                              disabled={busyId === line.intraUserId}
                              autoFocus
                            />
                          </div>
                          <div>
                            <Label htmlFor={`method-${line.intraUserId}`}>Forma</Label>
                            <select
                              id={`method-${line.intraUserId}`}
                              className="flex h-10 w-full rounded-md border border-border bg-white px-3 text-sm dark:border-border dark:bg-card"
                              value={payoutMethod}
                              onChange={(e) =>
                                setPayoutMethod(
                                  e.target.value as FinancialTransactionMethod,
                                )
                              }
                            >
                              {(
                                Object.entries(METHOD_PT) as Array<
                                  [FinancialTransactionMethod, string]
                                >
                              ).map(([k, v]) => (
                                <option key={k} value={k}>
                                  {v}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex items-end gap-2">
                            <Button
                              type="button"
                              size="sm"
                              disabled={busyId === line.intraUserId}
                              onClick={() => void confirmPay(line)}
                            >
                              {busyId === line.intraUserId ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                "Confirmar repasse"
                              )}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => setPayingId(null)}
                            >
                              Cancelar
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {open ? (
                      <div className="mt-3 space-y-3 border-t border-border pt-3">
                        <div>
                          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                            Atendimentos
                          </p>
                          {line.attendances.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                              Nenhum atendimento atribuído neste período.
                            </p>
                          ) : (
                            <ul className="space-y-1.5">
                              {line.attendances.map((a) => (
                                <li
                                  key={a.consumptionId}
                                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs"
                                >
                                  <span className="tabular-nums text-muted-foreground">
                                    {new Date(a.attendanceDateIso).toLocaleDateString(
                                      "pt-BR",
                                    )}
                                  </span>
                                  <Link
                                    href={`/dashboard/patients/${a.patientId}?tab=services`}
                                    className="font-medium text-clinical underline-offset-2 hover:underline"
                                  >
                                    {a.patientName}
                                  </Link>
                                  {a.serviceName ? (
                                    <span className="text-muted-foreground">
                                      {a.serviceName}
                                    </span>
                                  ) : null}
                                  <span className="ml-auto font-medium tabular-nums">
                                    {formatBrlFromCents(a.sessionValueCents)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        <div>
                          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                            Repasses neste período
                          </p>
                          {line.payouts.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                              Nenhum repasse registrado.
                            </p>
                          ) : (
                            <ul className="space-y-1.5">
                              {line.payouts.map((p) => (
                                <li
                                  key={p.payoutId}
                                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs"
                                >
                                  <span className="tabular-nums text-muted-foreground">
                                    {new Date(p.paidAtIso).toLocaleString("pt-BR", {
                                      day: "2-digit",
                                      month: "2-digit",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </span>
                                  <span className="font-medium tabular-nums">
                                    {formatBrlFromCents(p.amountCents)}
                                  </span>
                                  <span className="text-muted-foreground">
                                    {METHOD_PT[p.method as FinancialTransactionMethod] ??
                                      p.method}
                                  </span>
                                  {p.notes ? (
                                    <span className="text-muted-foreground truncate max-w-[12rem]">
                                      {p.notes}
                                    </span>
                                  ) : null}
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="ml-auto h-6 px-2 text-destructive"
                                    disabled={busyId === p.payoutId}
                                    onClick={() =>
                                      void voidPayout(p.payoutId, line.name, p.amountCents)
                                    }
                                  >
                                    {busyId === p.payoutId ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      "Estornar"
                                    )}
                                  </Button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryTile({
  label,
  hint,
  value,
  emphasize,
}: {
  label: string;
  hint: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border px-3 py-2.5",
        emphasize && "border-warning/40 bg-warning/5",
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
