"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, TrendingDown, TrendingUp, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  createFinancialTransaction,
  getCollaboratorBalanceDueSummary,
  getFinancePeriodReport,
  listFinancialTransactions,
  listPendingPaymentPurchases,
  summarizeFinancialPeriod,
  voidFinancialTransaction,
  updateFinancialTransactionMeta,
} from "@/app/actions/clinic-finances";
import type { FinancePeriodReport as ReportData } from "@/app/actions/clinic-finances";
import { FINANCE_PERIOD_PRESETS, type FinancePeriodPreset } from "@/lib/finance/period";
import type { FinancialTransactionKind, FinancialTransactionMethod } from "@prisma/client";
import {
  formatBrlFromCents,
  METHOD_PT,
  rawMoneyToCents,
  todayInput,
} from "./finance-format";
import { financeOutlineBtnClass } from "./finance-outline-btn";
import { inclusiveEndFromExclusiveUtc, toDateInputLocal } from "./finance-period-bounds";
import { FinanceSpaceSwitcher, type SpaceViewValue } from "./FinanceSpaceSwitcher";
import { CollaboratorBalancePanel } from "./CollaboratorBalancePanel";
import { FinancePeriodBreakdown } from "./FinancePeriodBreakdown";

const PRESET_LABEL: Record<FinancePeriodPreset, string> = {
  DAY: "Dia",
  WEEK: "Semana",
  MONTH: "Mês",
  QUARTER: "Trimestre",
  SEMESTER: "Semestre",
  YEAR: "Ano",
};

const KIND_PT: Record<FinancialTransactionKind, string> = {
  INCOME: "Receita",
  EXPENSE: "Despesa",
};

type TxRow = {
  id: string;
  kind: FinancialTransactionKind;
  amountCents: number;
  occurredAt: Date;
  method: FinancialTransactionMethod;
  description: string | null;
  patientId?: string | null;
  patientName?: string | null;
  category: string | null;
  serviceSpaceName?: string | null;
  serviceSpaceColor?: string | null;
  canVoid: boolean;
};

type PendingRow = {
  purchaseId: string;
  patientId: string;
  patientName: string;
  serviceName: string;
  agreedPriceCents: number;
  purchasedAt: Date;
  collectHref: string;
};

type SimpleSummary = {
  incomeCents: number;
  expenseCents: number;
  netCents: number;
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

export function FinanceAnalyzePanel({
  reloadKey = 0,
  onPeriodBoundsChange,
  initialPreset,
  initialAnchorIso,
  initialFrom,
  initialTo,
  highlightPending = false,
  isTeamPlan = false,
  /** Deep-link `action=collect&purchaseId=` — abre o formulário de recebimento. */
  collectPurchaseId = null,
  /** Paciente do deep-link (estreita a lista de pendências ao cobrar). */
  collectPatientId = null,
  onCollectHandled,
}: {
  reloadKey?: number;
  onPeriodBoundsChange?: (start: Date, endInclusive: Date) => void;
  initialPreset?: FinancePeriodPreset | null;
  initialAnchorIso?: string | null;
  initialFrom?: string | null;
  initialTo?: string | null;
  highlightPending?: boolean;
  /** Consultório/Clínica: painel de atendimentos por Intra User. */
  isTeamPlan?: boolean;
  collectPurchaseId?: string | null;
  collectPatientId?: string | null;
  onCollectHandled?: () => void;
}) {
  const [spaceView, setSpaceView] = useState<SpaceViewValue>("all");
  const [viewMode, setViewMode] = useState<"preset" | "custom">(
    initialFrom && initialTo ? "custom" : "preset",
  );
  const [preset, setPreset] = useState<FinancePeriodPreset>(initialPreset ?? "MONTH");
  const [offset, setOffset] = useState(0);
  const [anchorIso] = useState<string | null>(initialAnchorIso ?? null);
  const [customStartStr, setCustomStartStr] = useState(() => {
    if (initialFrom) return initialFrom;
    const d = new Date();
    return toDateInputLocal(new Date(d.getFullYear(), d.getMonth(), 1));
  });
  const [customEndStr, setCustomEndStr] = useState(() =>
    initialTo ? initialTo : toDateInputLocal(new Date()),
  );

  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ReportData | null>(null);
  const [simpleSummary, setSimpleSummary] = useState<SimpleSummary | null>(null);
  const [txRows, setTxRows] = useState<TxRow[]>([]);
  const [pendingRows, setPendingRows] = useState<PendingRow[]>([]);
  const [periodLabel, setPeriodLabel] = useState("—");
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [collectingPurchaseId, setCollectingPurchaseId] = useState<string | null>(null);
  const [collectMethod, setCollectMethod] = useState<FinancialTransactionMethod>("PIX");
  const [collectDate, setCollectDate] = useState(todayInput());
  const [collectPriceRaw, setCollectPriceRaw] = useState("");
  const [collectBusy, setCollectBusy] = useState(false);
  /** True após a 1ª tentativa de carregar pendências (evita deep-link preso em lista vazia inicial). */
  const [pendingHydrated, setPendingHydrated] = useState(false);
  const [analyzeTab, setAnalyzeTab] = useState<"resumo" | "balanco">("resumo");
  const [collaboratorDueCents, setCollaboratorDueCents] = useState(0);

  const refreshCollaboratorDueBadge = useCallback(async () => {
    if (!isTeamPlan) {
      setCollaboratorDueCents(0);
      return;
    }
    const res = await getCollaboratorBalanceDueSummary();
    if (res.success && res.data?.enabled) {
      setCollaboratorDueCents(res.data.balanceCents);
    } else {
      setCollaboratorDueCents(0);
    }
  }, [isTeamPlan]);

  useEffect(() => {
    void refreshCollaboratorDueBadge();
  }, [refreshCollaboratorDueBadge, reloadKey]);

  const notifyBounds = useCallback(
    (start: Date, endInclusive: Date) => {
      onPeriodBoundsChange?.(start, endInclusive);
    },
    [onPeriodBoundsChange],
  );

  const fetchPendingRows = useCallback(async (spaceParam: string | undefined) => {
    const pending = await listPendingPaymentPurchases({
      limit: 12,
      ...(spaceParam ? { serviceSpaceId: spaceParam } : {}),
    });
    if (pending.success && pending.data) {
      setPendingRows(pending.data);
    } else if (!pending.success) {
      setPendingRows([]);
    }
    setPendingHydrated(true);
    return pending;
  }, []);

  const loadPreset = useCallback(async () => {
    setLoading(true);
    try {
      const spaceParam = spaceView === "all" ? undefined : spaceView;
      const res = await getFinancePeriodReport({
        preset,
        offset,
        ...(anchorIso && offset === 0 ? { anchorIso } : {}),
        ...(spaceParam ? { serviceSpaceId: spaceParam } : {}),
      });
      if (!res.success || !res.data) {
        toast.error(res.success ? "Relatório indisponível." : res.error);
        setPendingHydrated(true);
        return;
      }
      setReport(res.data);
      setSimpleSummary(null);
      setPeriodLabel(res.data.label);

      const start = new Date(res.data.startIso);
      const endInclusive = inclusiveEndFromExclusiveUtc(res.data.endIso);
      notifyBounds(start, endInclusive);

      const [list] = await Promise.all([
        listFinancialTransactions({
          start,
          end: endInclusive,
          ...(spaceParam ? { serviceSpaceId: spaceParam } : {}),
        }),
        fetchPendingRows(spaceParam),
      ]);
      if (list.success && list.data) {
        setTxRows(list.data);
      }
    } finally {
      setLoading(false);
    }
  }, [anchorIso, fetchPendingRows, notifyBounds, offset, preset, spaceView]);

  const loadCustom = useCallback(async () => {
    const start = new Date(customStartStr + "T00:00:00");
    const end = new Date(customEndStr + "T23:59:59.999");
    if (start > end) {
      toast.error("Data de início deve ser anterior à data de fim.");
      return;
    }
    setLoading(true);
    try {
      const spaceParam = spaceView === "all" ? undefined : spaceView;
      const spaceFilter = spaceParam ? { serviceSpaceId: spaceParam } : {};
      setReport(null);
      const [sum, list] = await Promise.all([
        summarizeFinancialPeriod({ start, end, ...spaceFilter }),
        listFinancialTransactions({
          start,
          end,
          ...spaceFilter,
        }),
        fetchPendingRows(spaceParam),
      ]);
      if (!sum.success || !sum.data) {
        toast.error(sum.success ? "Resumo indisponível." : sum.error);
      } else {
        setSimpleSummary(sum.data);
      }
      if (!list.success || !list.data) {
        toast.error(list.success ? "Lançamentos indisponíveis." : list.error);
        setTxRows([]);
      } else {
        setTxRows(list.data);
      }
      const label = `${start.toLocaleDateString("pt-BR")} – ${end.toLocaleDateString("pt-BR")}`;
      setPeriodLabel(label);
      notifyBounds(start, end);
    } finally {
      setLoading(false);
    }
  }, [customEndStr, customStartStr, fetchPendingRows, notifyBounds, spaceView]);

  const reloadPendingOnly = useCallback(async () => {
    const spaceParam = spaceView === "all" ? undefined : spaceView;
    await fetchPendingRows(spaceParam);
  }, [fetchPendingRows, spaceView]);

  function openCollectPayment(row: PendingRow) {
    setCollectingPurchaseId(row.purchaseId);
    setCollectMethod("PIX");
    setCollectDate(todayInput());
    setCollectPriceRaw(
      row.agreedPriceCents > 0
        ? (row.agreedPriceCents / 100).toFixed(2).replace(".", ",")
        : "",
    );
  }

  async function submitCollectPayment(row: PendingRow) {
    const cents = rawMoneyToCents(collectPriceRaw);
    if (cents == null || cents <= 0) {
      toast.error("Informe um valor válido para o recebimento.");
      return;
    }
    setCollectBusy(true);
    try {
      const result = await createFinancialTransaction({
        kind: "INCOME",
        amountCents: cents,
        occurredAt: new Date(`${collectDate}T12:00:00`),
        method: collectMethod,
        patientId: row.patientId,
        purchaseId: row.purchaseId,
        description: `Recebimento — ${row.serviceName}`,
        source: "MANUAL",
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Entrada registrada e vinculada à compra.");
      setCollectingPurchaseId(null);
      await reloadPendingOnly();
      // Relatório em background — não prende o botão nos 10–25s do período.
      if (viewMode === "preset") void loadPreset();
      else void loadCustom();
    } finally {
      setCollectBusy(false);
    }
  }

  useEffect(() => {
    if (!collectPurchaseId) return;
    if (!pendingHydrated) return;

    let cancelled = false;

    async function resolveCollectTarget() {
      let row = pendingRows.find((p) => p.purchaseId === collectPurchaseId);
      // Fora do top 12 global: busca ampliada pelo paciente do deep-link.
      if (!row && collectPatientId) {
        const widened = await listPendingPaymentPurchases({
          patientId: collectPatientId,
          limit: 100,
        });
        if (cancelled) return;
        if (widened.success && widened.data) {
          row = widened.data.find((p) => p.purchaseId === collectPurchaseId);
          if (row) {
            setPendingRows((prev) => {
              if (prev.some((p) => p.purchaseId === row!.purchaseId)) return prev;
              return [row!, ...prev];
            });
          }
        }
      }
      if (cancelled) return;
      if (!row) {
        toast.info(
          "Esta compra não está entre as pendências (já paga ou inválida).",
          { duration: 7000 },
        );
        onCollectHandled?.();
        return;
      }
      if (collectingPurchaseId === collectPurchaseId) {
        onCollectHandled?.();
        return;
      }
      openCollectPayment(row);
      toast.info("Confirme o valor e a forma de pagamento abaixo.", { duration: 6000 });
      onCollectHandled?.();
    }

    void resolveCollectTarget();
    return () => {
      cancelled = true;
    };
    // Deep-link one-shot após hidratar pendências.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectPurchaseId, collectPatientId, pendingHydrated, pendingRows]);

  useEffect(() => {
    if (viewMode === "preset") {
      void loadPreset();
    } else if (initialFrom && initialTo) {
      void loadCustom();
    }
  }, [loadPreset, loadCustom, reloadKey, viewMode, initialFrom, initialTo]);

  async function handleVoid(id: string) {
    const reason = window.prompt("Motivo do estorno (obrigatório):");
    if (!reason || reason.trim().length < 3) {
      toast.error("Informe um motivo com pelo menos 3 caracteres.");
      return;
    }
    if (!window.confirm("Estornar este lançamento? Ele sai do relatório e do extrato.")) return;
    setVoidingId(id);
    try {
      const res = await voidFinancialTransaction({ transactionId: id, reason: reason.trim() });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Lançamento estornado.");
      if (viewMode === "preset") await loadPreset();
      else await loadCustom();
    } finally {
      setVoidingId(null);
    }
  }

  async function handleQuickEditDescription(id: string, current: string | null) {
    const next = window.prompt("Nova descrição:", current ?? "");
    if (next === null) return;
    const res = await updateFinancialTransactionMeta({
      transactionId: id,
      description: next.trim(),
    });
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success("Descrição atualizada.");
    if (viewMode === "preset") await loadPreset();
    else await loadCustom();
  }

  const totals = report?.totals;

  const displayIncome =
    totals?.grossIncomeCents ?? simpleSummary?.incomeCents ?? 0;
  const displayFixed = totals?.fixedExpenseCents ?? null;
  const displayVariable = totals?.variableExpenseCents ?? null;
  const displayExpenseTotal =
    displayFixed !== null && displayVariable !== null
      ? displayFixed + displayVariable
      : simpleSummary?.expenseCents ?? 0;
  const displayNet = totals?.netCents ?? simpleSummary?.netCents ?? 0;

  return (
    <div className="space-y-6">
      <FinanceSpaceSwitcher onChange={setSpaceView} />

      {isTeamPlan ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={analyzeTab === "resumo" ? "default" : "outline"}
            className={analyzeTab === "resumo" ? undefined : financeOutlineBtnClass}
            onClick={() => setAnalyzeTab("resumo")}
          >
            Resumo
          </Button>
          <Button
            type="button"
            size="sm"
            variant={analyzeTab === "balanco" ? "default" : "outline"}
            className={analyzeTab === "balanco" ? undefined : financeOutlineBtnClass}
            onClick={() => setAnalyzeTab("balanco")}
          >
            Balanço dos colaboradores
            {collaboratorDueCents > 0 ? (
              <Badge
                variant="secondary"
                className="ml-2 bg-warning/20 text-warning hover:bg-warning/20"
              >
                A pagar {formatBrlFromCents(collaboratorDueCents)}
              </Badge>
            ) : null}
          </Button>
        </div>
      ) : null}

      {isTeamPlan && analyzeTab === "balanco" ? (
        <CollaboratorBalancePanel
          reloadKey={reloadKey}
          onDueChange={(cents) => {
            setCollaboratorDueCents(cents);
          }}
        />
      ) : null}

      {(!isTeamPlan || analyzeTab === "resumo") && (
        <>
      {(highlightPending || pendingRows.length > 0) && (
        <Card
          className={cn(
            "border-warning/40 bg-warning/10 shadow-sm dark:border-warning/30 dark:bg-warning/15",
            highlightPending && "ring-2 ring-warning/40",
          )}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Pagamentos pendentes</CardTitle>
            <CardDescription>
              Vendas sem entrada no caixa. Registre o recebimento aqui — sem sair desta
              aba (evita recarregar o relatório inteiro).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {pendingRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma compra pendente.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {pendingRows.map((p) => (
                  <li
                    key={p.purchaseId}
                    className={cn(
                      "rounded-lg border border-border bg-card px-3 py-2",
                      collectingPurchaseId === p.purchaseId &&
                        "ring-2 ring-primary/40 border-primary/40",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{p.patientName}</span>
                      <span className="text-muted-foreground">{p.serviceName}</span>
                      <span className="font-medium">{formatBrlFromCents(p.agreedPriceCents)}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(p.purchasedAt).toLocaleDateString("pt-BR")}
                      </span>
                      {collectingPurchaseId !== p.purchaseId ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="ml-auto h-7"
                          disabled={collectBusy}
                          onClick={() => openCollectPayment(p)}
                        >
                          Registrar pagamento
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="ml-auto h-7"
                          disabled={collectBusy}
                          onClick={() => setCollectingPurchaseId(null)}
                        >
                          Cancelar
                        </Button>
                      )}
                    </div>
                    {collectingPurchaseId === p.purchaseId && (
                      <div className="mt-3 space-y-3 rounded-md border border-dashed border-border bg-muted/40 p-3">
                        <p className="text-xs text-muted-foreground">
                          Registra uma entrada no caixa ligada a esta compra — não cria
                          nova venda nem altera sessões.
                        </p>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div>
                            <Label htmlFor={`analyze-collect-price-${p.purchaseId}`}>
                              Valor (R$)
                            </Label>
                            <Input
                              id={`analyze-collect-price-${p.purchaseId}`}
                              inputMode="decimal"
                              value={collectPriceRaw}
                              onChange={(e) => setCollectPriceRaw(e.target.value)}
                            />
                          </div>
                          <div>
                            <Label htmlFor={`analyze-collect-method-${p.purchaseId}`}>
                              Forma
                            </Label>
                            <select
                              id={`analyze-collect-method-${p.purchaseId}`}
                              className="flex h-10 w-full rounded-md border border-border bg-white px-3 text-sm dark:bg-card"
                              value={collectMethod}
                              onChange={(e) =>
                                setCollectMethod(e.target.value as FinancialTransactionMethod)
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
                          <div>
                            <Label htmlFor={`analyze-collect-date-${p.purchaseId}`}>
                              Data
                            </Label>
                            <Input
                              id={`analyze-collect-date-${p.purchaseId}`}
                              type="date"
                              max={todayInput()}
                              value={collectDate}
                              onChange={(e) => setCollectDate(e.target.value)}
                            />
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          disabled={collectBusy}
                          onClick={() => void submitCollectPayment(p)}
                        >
                          {collectBusy ? (
                            <>
                              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                              Registrando…
                            </>
                          ) : (
                            "Confirmar recebimento"
                          )}
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="border-border bg-white shadow-sm dark:border-border dark:bg-card">
        <CardHeader>
          <CardTitle>Resumo financeiro</CardTitle>
          <CardDescription>
            Entrada bruta, despesas fixas e variáveis, e total líquido. O mesmo período é usado na
            exportação fiscal.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            {FINANCE_PERIOD_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setViewMode("preset");
                  setPreset(p);
                  setOffset(0);
                }}
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm font-medium transition",
                  viewMode === "preset" && preset === p
                    ? "bg-clinical shadow-sm"
                    : "bg-muted text-foreground/90 hover:bg-muted dark:bg-muted dark:text-muted-foreground dark:hover:bg-muted",
                )}
              >
                {PRESET_LABEL[p]}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setViewMode("custom")}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm font-medium transition",
                viewMode === "custom"
                  ? "bg-clinical shadow-sm"
                  : "bg-muted text-foreground/90 hover:bg-muted dark:bg-muted dark:text-muted-foreground dark:hover:bg-muted",
              )}
            >
              Personalizado
            </button>
          </div>

          {viewMode === "preset" ? (
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
                <p className="text-sm font-semibold">{periodLabel}</p>
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
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label htmlFor="fin-start">Início</Label>
                <Input
                  id="fin-start"
                  type="date"
                  value={customStartStr}
                  onChange={(e) => setCustomStartStr(e.target.value)}
                  className="w-44"
                />
              </div>
              <div>
                <Label htmlFor="fin-end">Fim</Label>
                <Input
                  id="fin-end"
                  type="date"
                  value={customEndStr}
                  onChange={(e) => setCustomEndStr(e.target.value)}
                  className="w-44"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                className={financeOutlineBtnClass}
                disabled={loading}
                onClick={() => void loadCustom()}
              >
                Aplicar intervalo
              </Button>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-clinical/30 bg-clinical/10 p-4 dark:border-clinical/30 dark:bg-clinical/15">
              <p className="text-xs uppercase tracking-wide text-clinical/80 dark:text-clinical/80">
                Entrada bruta
              </p>
              <p className="text-xl font-bold text-clinical dark:text-clinical">
                {formatBrlFromCents(displayIncome)}
              </p>
              {report && <DeltaBadge pct={report.previous.grossDeltaPct} />}
            </div>
            <div className="rounded-xl border border-border bg-muted p-4 dark:border-border dark:bg-muted/40">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Despesa fixa</p>
              <p className="text-xl font-bold text-warning">
                {displayFixed !== null ? formatBrlFromCents(displayFixed) : "—"}
              </p>
              {viewMode === "custom" && (
                <p className="text-[10px] text-muted-foreground">Use presets para detalhar fixo/variável</p>
              )}
            </div>
            <div className="rounded-xl border border-border bg-muted p-4 dark:border-border dark:bg-muted/40">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Despesa variável</p>
              <p className="text-xl font-bold text-destructive">
                {displayVariable !== null ? formatBrlFromCents(displayVariable) : "—"}
              </p>
            </div>
            <div
              className={cn(
                "rounded-xl border p-4",
                displayNet >= 0
                  ? "border-clinical/30 bg-clinical/10 dark:border-clinical/30 dark:bg-clinical/15"
                  : "border-warning/30 bg-warning/10 dark:border-warning/40 dark:bg-warning/15",
              )}
            >
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Total líquido</p>
              <p
                className={cn(
                  "text-xl font-bold",
                  displayNet >= 0
                    ? "text-clinical"
                    : "text-warning",
                )}
              >
                {formatBrlFromCents(displayNet)}
              </p>
              {report && <DeltaBadge pct={report.previous.netDeltaPct} />}
              {viewMode === "custom" && simpleSummary && (
                <p className="text-[10px] text-muted-foreground">
                  Despesas totais: {formatBrlFromCents(displayExpenseTotal)}
                </p>
              )}
            </div>
          </div>

          {report ? <FinancePeriodBreakdown report={report} /> : null}
        </CardContent>
      </Card>

      <Card className="border-border bg-white shadow-sm dark:border-border dark:bg-card">
        <CardHeader>
          <CardTitle>Lançamentos do período</CardTitle>
          <CardDescription>
            Extrato detalhado de receitas e despesas em {periodLabel}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-80 overflow-y-auto rounded-xl border border-border">
            {txRows.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Sem lançamentos neste período.</p>
            ) : (
              <ul className="divide-y divide-border dark:divide-border">
                {txRows.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                    <Badge variant={t.kind === "INCOME" ? "default" : "secondary"}>
                      {KIND_PT[t.kind]}
                    </Badge>
                    {t.serviceSpaceName ? (
                      <Badge
                        variant="outline"
                        className="gap-1.5"
                        style={{ borderColor: t.serviceSpaceColor ?? undefined }}
                      >
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: t.serviceSpaceColor ?? "#888" }}
                          aria-hidden
                        />
                        {t.serviceSpaceName}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        Geral
                      </Badge>
                    )}
                    <span className="font-medium">{formatBrlFromCents(t.amountCents)}</span>
                    <span className="text-muted-foreground">{METHOD_PT[t.method]}</span>
                    <span className="text-muted-foreground">
                      {new Date(t.occurredAt).toLocaleDateString("pt-BR")}
                    </span>
                    {t.patientName ? (
                      <Badge variant="outline" className="font-normal">
                        {t.patientName}
                      </Badge>
                    ) : null}
                    {t.description && (
                      <button
                        type="button"
                        className="w-full text-left text-muted-foreground hover:underline"
                        onClick={() => void handleQuickEditDescription(t.id, t.description)}
                        title="Editar descrição"
                      >
                        {t.description}
                      </button>
                    )}
                    {!t.description && (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:underline"
                        onClick={() => void handleQuickEditDescription(t.id, null)}
                      >
                        + descrição
                      </button>
                    )}
                    {t.canVoid && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="ml-auto h-7 gap-1 px-2 text-destructive"
                        disabled={voidingId === t.id}
                        onClick={() => void handleVoid(t.id)}
                      >
                        {voidingId === t.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Undo2 className="h-3 w-3" />
                        )}
                        Estornar
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
        </>
      )}
    </div>
  );
}
