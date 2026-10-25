"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  ExternalLink,
  FileJson,
  Loader2,
  AlertTriangle,
  Info,
  FileCheck2,
  RefreshCw,
  Clock,
  Ban,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  exportReceitaSaudeCsv,
  listFiscalTransactions,
  previewNfseForTransaction,
  type FiscalTransactionRow,
} from "@/app/actions/fiscal-export";
import { getMyFiscalProfile } from "@/app/actions/fiscal-profile";
import {
  emitNfseForTransaction,
  cancelNfseForTransaction,
  getFiscalNfseClientConfig,
  refreshNfseDocumentStatus,
  type FiscalNfseClientConfig,
} from "@/app/actions/fiscal-nfse";
import { Textarea } from "@/components/ui/textarea";
import { FISCAL_EXTERNAL_LINKS } from "@/lib/fiscal/receita-saude-csv";
import { formatCnpjInput } from "@/lib/fiscal/validation";
import { FISCAL_STATUS_LABEL, NFSE_DOCUMENT_STATUS_LABEL } from "@/lib/fiscal/transaction-fiscal-status";
import type { FiscalRegime } from "@prisma/client";
import { cn } from "@/lib/utils";
import { financeOutlineBtnClass } from "./finance-outline-btn";

function formatBrlFromCents(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );
}

function downloadBase64Csv(base64: string, filename: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function statusBadgeClass(status: FiscalTransactionRow["fiscalExportStatus"]): string {
  switch (status) {
    case "READY":
      return "bg-clinical/15 text-clinical dark:bg-clinical/15 dark:text-clinical";
    case "PENDING":
      return "bg-warning/15 text-warning dark:bg-warning/15 dark:text-warning";
    case "EXPORTED":
      return "bg-primary/15 text-primary dark:bg-primary/15 dark:text-primary";
    default:
      return "";
  }
}

interface FiscalExportPanelProps {
  periodStart: Date;
  periodEnd: Date;
  reloadKey?: number;
}

export function FiscalExportPanel({ periodStart, periodEnd, reloadKey = 0 }: FiscalExportPanelProps) {
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [regime, setRegime] = useState<FiscalRegime>("UNSPECIFIED");
  const [rows, setRows] = useState<FiscalTransactionRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewJson, setPreviewJson] = useState<string | null>(null);
  const [nfseConfig, setNfseConfig] = useState<FiscalNfseClientConfig | null>(null);
  const [emittingId, setEmittingId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelTargetId, setCancelTargetId] = useState<string | null>(null);
  const [cancelMotivo, setCancelMotivo] = useState("");
  const [cnpj, setCnpj] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [profileRes, txRes, nfseCfg] = await Promise.all([
        getMyFiscalProfile(),
        listFiscalTransactions({ start: periodStart, end: periodEnd }),
        getFiscalNfseClientConfig(),
      ]);
      setNfseConfig(nfseCfg);
      if (profileRes.success && profileRes.data) {
        setRegime(profileRes.data.fiscalRegime);
        setCnpj(
          profileRes.data.professionalCnpj
            ? formatCnpjInput(profileRes.data.professionalCnpj)
            : "",
        );
      }
      if (!txRes.success || !txRes.data) {
        toast.error(txRes.success ? "Erro ao carregar receitas." : txRes.error);
        return;
      }
      setRows(txRes.data);
      setSelected(new Set());
    } finally {
      setLoading(false);
    }
  }, [periodStart, periodEnd]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const incomeRows = useMemo(() => rows.filter((r) => r.kind === "INCOME"), [rows]);
  const exportableIds = useMemo(
    () => incomeRows.filter((r) => r.fiscal.canExportReceitaSaude).map((r) => r.id),
    [incomeRows],
  );

  const nfseUserActive = Boolean(nfseConfig?.userFacingActive);
  const nfseComingSoon = Boolean(nfseConfig?.comingSoon);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllExportable() {
    setSelected(new Set(exportableIds));
  }

  async function handleExport() {
    const ids = [...selected].filter((id) => exportableIds.includes(id));
    if (ids.length === 0) {
      toast.error("Selecione receitas prontas para exportação.");
      return;
    }
    setExporting(true);
    try {
      const res = await exportReceitaSaudeCsv({ transactionIds: ids });
      if (!res.success || !res.data) {
        toast.error(res.success ? "Exportação falhou." : res.error);
        return;
      }
      downloadBase64Csv(res.data.csvBase64, res.data.filename);
      res.data.warnings.forEach((w) => toast.warning(w));
      toast.success(`${res.data.exportedCount} receita(s) exportada(s). Importe no Carnê-Leão Web.`);
      await load();
    } finally {
      setExporting(false);
    }
  }

  async function handleEmitNfse(id: string) {
    setEmittingId(id);
    try {
      const res = await emitNfseForTransaction({ transactionId: id });
      if (!res.success || !res.data) {
        toast.error(res.success ? "Emissão falhou." : res.error);
        return;
      }
      toast.success("NFS-e enfileirada. Aguarde confirmação (webhook).");
      await load();
    } finally {
      setEmittingId(null);
    }
  }

  async function handleRefreshNfse(id: string) {
    setRefreshingId(id);
    try {
      const res = await refreshNfseDocumentStatus(id);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success(`Status: ${NFSE_DOCUMENT_STATUS_LABEL[res.data!.status] ?? res.data!.status}`);
      await load();
    } finally {
      setRefreshingId(null);
    }
  }

  async function handleCancelNfse(id: string) {
    setCancellingId(id);
    try {
      const res = await cancelNfseForTransaction({
        transactionId: id,
        motivo: cancelMotivo.trim() || undefined,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Cancelamento solicitado. Aguarde confirmação (webhook) ou atualize o status.");
      setCancelTargetId(null);
      setCancelMotivo("");
      await load();
    } finally {
      setCancellingId(null);
    }
  }

  async function handlePreviewNfse(id: string) {
    const res = await previewNfseForTransaction(id);
    if (!res.success || !res.data) {
      toast.error(res.success ? "Pré-visualização indisponível." : res.error);
      return;
    }
    setPreviewJson(JSON.stringify(res.data, null, 2));
  }

  const isPf = regime === "PF_CARNE_LEAO";
  const isPj = regime === "PJ_SIMPLES" || regime === "PJ_PRESUMIDO";

  return (
    <Card className="border-warning/30 bg-gradient-to-b from-warning/10 to-white shadow-sm dark:border-warning/25 dark:from-warning/20 dark:to-card lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Info className="h-5 w-5 text-warning" />
          Documentação fiscal (Receita Saúde)
        </CardTitle>
        <CardDescription>
          <strong className="text-warning dark:text-warning">Recibo PDF ≠ Receita Saúde.</strong>{" "}
          O documento em «Gerar documento» é comprovante clínico. Para PF, exporte CSV e importe no{" "}
          <a
            href={FISCAL_EXTERNAL_LINKS.carneLeaoWeb}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline dark:text-primary"
          >
            Carnê-Leão Web
          </a>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-white p-4 shadow-sm dark:border-primary/30 dark:from-primary/20 dark:to-card">
          <p className="text-sm font-semibold text-foreground">
            Emissão de NFS-e (Notaas)
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Informe o CNPJ do consultório para preparar a emissão de notas fiscais de serviço.
          </p>
          <div className="mt-4 space-y-3">
            <div className="max-w-md">
              <Label htmlFor="fiscal-tab-cnpj">CNPJ do consultório</Label>
              <Input
                id="fiscal-tab-cnpj"
                inputMode="numeric"
                placeholder="00.000.000/0000-00"
                value={cnpj}
                onChange={(e) => setCnpj(formatCnpjInput(e.target.value))}
                autoComplete="off"
                className="mt-1"
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                A emissão de NFS-e ainda não está disponível nesta conta.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                disabled
                className="gap-2 bg-primary text-primary-foreground shadow-md hover:bg-primary disabled:opacity-100"
                aria-disabled
              >
                <FileCheck2 className="h-4 w-4" aria-hidden />
                Emitir eNotaa
              </Button>
              <Badge className="border-warning/40 bg-warning/15 text-warning dark:border-warning/40 dark:bg-warning/15 dark:text-warning">
                Em Breve
              </Badge>
            </div>
          </div>
        </div>

        {regime === "UNSPECIFIED" && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm dark:border-warning/30 dark:bg-warning/15">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
            <span>O regime tributário desta conta ainda não foi definido.</span>
          </div>
        )}

        {isPj && nfseComingSoon && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm dark:border-primary/30 dark:bg-primary/15">
            <Clock className="h-4 w-4 shrink-0 text-primary" />
            <span className="font-medium text-primary dark:text-primary">
              {nfseConfig?.message ?? "Função será ativada em breve"}
            </span>
          </div>
        )}

        {isPj && !nfseComingSoon && (
          <p className="text-sm text-muted-foreground">
            Regime PJ: emita NFS-e por receita
            {nfseUserActive ? " (Notaas configurado)." : " — emissão automática indisponível no servidor."}
          </p>
        )}

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> A carregar receitas…
          </p>
        ) : incomeRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma receita no período selecionado.</p>
        ) : (
          <>
            {isPf && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={financeOutlineBtnClass}
                  onClick={selectAllExportable}
                >
                  Selecionar prontas ({exportableIds.length})
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={exporting || selected.size === 0}
                  onClick={() => void handleExport()}
                  className="gap-2"
                >
                  {exporting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  Exportar Receita Saúde (CSV)
                </Button>
                <Button type="button" variant="ghost" size="sm" asChild>
                  <a
                    href={FISCAL_EXTERNAL_LINKS.receitaSaudeFaq}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="gap-1"
                  >
                    FAQ Receita Saúde <ExternalLink className="h-3 w-3" />
                  </a>
                </Button>
              </div>
            )}

            <ul className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-border p-2 dark:border-border">
              {incomeRows.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm dark:bg-muted/50"
                >
                  {isPf && (
                    <input
                      type="checkbox"
                      checked={selected.has(t.id)}
                      disabled={!t.fiscal.canExportReceitaSaude}
                      onChange={() => toggleSelect(t.id)}
                      aria-label={`Selecionar receita ${t.id}`}
                    />
                  )}
                  <span className="font-medium">{formatBrlFromCents(t.amountCents)}</span>
                  <span className="text-muted-foreground">
                    {new Date(t.occurredAt).toLocaleDateString("pt-BR")}
                  </span>
                  {t.patientName && (
                    <span className="truncate text-muted-foreground">{t.patientName}</span>
                  )}
                  {t.fiscal.status !== "NOT_APPLICABLE" && (
                    <Badge variant="outline" className={cn("text-xs", statusBadgeClass(t.fiscal.status))}>
                      {isPj && t.fiscal.nfseDocumentStatus
                        ? (NFSE_DOCUMENT_STATUS_LABEL[t.fiscal.nfseDocumentStatus] ??
                          FISCAL_STATUS_LABEL[t.fiscal.status])
                        : FISCAL_STATUS_LABEL[t.fiscal.status]}
                      {t.fiscal.needsReexport ? " · reexportar" : ""}
                    </Badge>
                  )}
                  {t.fiscal.status === "PENDING" && t.fiscal.missingFields.length > 0 && (
                    <span className="w-full text-xs text-warning">
                      Falta: {t.fiscal.missingFields.join(", ")}
                    </span>
                  )}
                  {isPj && nfseUserActive && (
                    <div className="ml-auto flex flex-wrap gap-1">
                      {t.fiscal.canEmitNfse && (
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          className="h-7 gap-1 px-2"
                          disabled={emittingId === t.id}
                          onClick={() => void handleEmitNfse(t.id)}
                        >
                          {emittingId === t.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <FileCheck2 className="h-3 w-3" />
                          )}
                          Emitir NFS-e
                        </Button>
                      )}
                      {(t.fiscal.nfseDocumentStatus === "QUEUED" ||
                        t.fiscal.nfseDocumentStatus === "PROCESSING" ||
                        t.fiscal.nfseDocumentStatus === "ISSUED") && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className={cn("h-7 gap-1 px-2", financeOutlineBtnClass)}
                          disabled={refreshingId === t.id}
                          onClick={() => void handleRefreshNfse(t.id)}
                        >
                          {refreshingId === t.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3 w-3" />
                          )}
                          Atualizar
                        </Button>
                      )}
                      {t.fiscal.canCancelNfse && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 px-2 text-destructive hover:text-destructive"
                          disabled={cancellingId === t.id}
                          onClick={() => {
                            setCancelTargetId(cancelTargetId === t.id ? null : t.id);
                            setCancelMotivo("");
                          }}
                        >
                          <Ban className="h-3 w-3" />
                          Cancelar NFS-e
                        </Button>
                      )}
                      {t.fiscal.nfseCancelRequested && (
                        <span className="text-xs text-muted-foreground">
                          Cancelamento pendente…
                        </span>
                      )}
                      {t.fiscal.canPreviewNfse && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 px-2"
                          onClick={() => void handlePreviewNfse(t.id)}
                        >
                          <FileJson className="h-3 w-3" /> Ver JSON
                        </Button>
                      )}
                    </div>
                  )}
                  {cancelTargetId === t.id && (
                    <div className="mt-2 w-full space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                      <Label htmlFor={`cancel-motivo-${t.id}`}>Motivo (opcional, máx. 255)</Label>
                      <Textarea
                        id={`cancel-motivo-${t.id}`}
                        value={cancelMotivo}
                        onChange={(e) => setCancelMotivo(e.target.value.slice(0, 255))}
                        rows={2}
                        placeholder="Ex.: erro de valor / dados do tomador"
                        className="text-sm"
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          disabled={cancellingId === t.id}
                          onClick={() => void handleCancelNfse(t.id)}
                          className="gap-1"
                        >
                          {cancellingId === t.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Ban className="h-3 w-3" />
                          )}
                          Confirmar cancelamento
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setCancelTargetId(null);
                            setCancelMotivo("");
                          }}
                        >
                          Fechar
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {previewJson && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase text-muted-foreground">Pré-visualização NFS-e</p>
              <Button type="button" variant="ghost" size="sm" onClick={() => setPreviewJson(null)}>
                Fechar
              </Button>
            </div>
            <pre className="max-h-48 overflow-auto rounded-lg bg-card p-3 text-xs text-foreground">
              {previewJson}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
