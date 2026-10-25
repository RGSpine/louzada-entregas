"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Clock, KeyRound, Loader2, ShieldCheck, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  clearMyNotaasByokApiKey,
  getMyFiscalIssuerStatus,
  saveMyNotaasByokApiKey,
  syncMyFiscalIssuerWithNotaas,
  uploadMyFiscalIssuerCertificate,
  type FiscalIssuerStatusPayload,
} from "@/app/actions/fiscal-issuer";
import { getFiscalNfseClientConfig, type FiscalNfseClientConfig } from "@/app/actions/fiscal-nfse";
import { maskApiKeyPrefix } from "@/lib/fiscal/secrets-crypto";
import { cn } from "@/lib/utils";

interface FiscalIssuerPanelProps {
  enabled: boolean;
  reloadKey?: number;
}

export function FiscalIssuerPanel({ enabled, reloadKey = 0 }: FiscalIssuerPanelProps) {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savingByok, setSavingByok] = useState(false);
  const [status, setStatus] = useState<FiscalIssuerStatusPayload | null>(null);
  const [nfseConfig, setNfseConfig] = useState<FiscalNfseClientConfig | null>(null);
  const [certFile, setCertFile] = useState<File | null>(null);
  const [certPassword, setCertPassword] = useState("");
  const [byokKey, setByokKey] = useState("");
  const [byokConfirmed, setByokConfirmed] = useState(false);
  const [showByokForm, setShowByokForm] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      setStatus(null);
      setNfseConfig(null);
      return;
    }
    setLoading(true);
    try {
      const [issuerRes, nfseCfg] = await Promise.all([
        getMyFiscalIssuerStatus(),
        getFiscalNfseClientConfig(),
      ]);
      setNfseConfig(nfseCfg);
      if (issuerRes.success && issuerRes.data) setStatus(issuerRes.data);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  if (!enabled) return null;

  const comingSoon = Boolean(nfseConfig?.comingSoon);

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await syncMyFiscalIssuerWithNotaas();
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Emitente registado no Notaas.");
      await load();
    } finally {
      setSyncing(false);
    }
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!certFile) {
      toast.error("Selecione o ficheiro .pfx ou .p12.");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("certificate", certFile);
      fd.append("password", certPassword);
      const res = await uploadMyFiscalIssuerCertificate(fd);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Certificado enviado. Emissão NFS-e disponível.");
      setCertFile(null);
      setCertPassword("");
      await load();
    } finally {
      setUploading(false);
    }
  }

  async function handleSaveByok(e: React.FormEvent) {
    e.preventDefault();
    if (!byokConfirmed) {
      toast.error("Confirme que o certificado A1 está activo no painel Notaas.");
      return;
    }
    setSavingByok(true);
    try {
      const res = await saveMyNotaasByokApiKey({
        apiKey: byokKey,
        certificateConfirmed: true as const,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Conta Notaas própria configurada (BYOK).");
      setByokKey("");
      setByokConfirmed(false);
      setShowByokForm(false);
      await load();
    } finally {
      setSavingByok(false);
    }
  }

  async function handleClearByok() {
    if (!window.confirm("Remover a API key BYOK e voltar ao fluxo da plataforma?")) return;
    setSavingByok(true);
    try {
      const res = await clearMyNotaasByokApiKey();
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("BYOK removido.");
      await load();
    } finally {
      setSavingByok(false);
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> A carregar emitente NFS-e…
      </p>
    );
  }

  if (comingSoon) {
    return (
      <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/10 p-4 dark:border-primary/30 dark:bg-primary/15">
        <div className="flex flex-wrap items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h3 className="font-medium text-foreground">Emitente NFS-e (seu consultório)</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-primary dark:text-primary">
          <Clock className="h-4 w-4 shrink-0" />
          <span className="font-medium">{nfseConfig?.message ?? "Função será ativada em breve"}</span>
        </div>
        <p className="text-sm text-muted-foreground">
          A emissão de NFS-e por consultório estará disponível em breve. Enquanto isso, continue a
          preencher os dados fiscais PJ acima.
        </p>
      </div>
    );
  }

  const badgeClass =
    status?.canEmit
      ? "bg-clinical/15 text-clinical dark:bg-clinical/15 dark:text-clinical"
      : "bg-warning/15 text-warning dark:bg-warning/15 dark:text-warning";

  const certAlert = status?.certificateAlert ?? "unknown";
  const showCertBanner =
    !status?.isByok &&
    (certAlert === "warn" || certAlert === "urgent" || certAlert === "expired");

  return (
    <div className="space-y-4 rounded-lg border border-border bg-muted/80 p-4 dark:border-border dark:bg-muted/40">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <h3 className="font-medium text-foreground">Emitente NFS-e (seu consultório)</h3>
        {status && (
          <Badge variant="outline" className={cn("text-xs", badgeClass)}>
            {status.statusLabel}
          </Badge>
        )}
        {status?.isByok && (
          <Badge variant="outline" className="text-xs">
            Conta própria (BYOK)
          </Badge>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        {status?.isByok
          ? "A emissão usa a API key da sua conta Notaas. O certificado A1 fica no painel Notaas — não é armazenado no Louzada Entregas."
          : "O certificado A1 é enviado diretamente ao Notaas e não fica guardado no Louzada Entregas. Cada consultório PJ emite notas em nome do próprio CNPJ."}
      </p>

      {showCertBanner && (
        <div
          className={cn(
            "flex gap-2 rounded-lg border px-3 py-2 text-sm",
            certAlert === "expired" || certAlert === "urgent"
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-warning/40 bg-warning/10 text-warning",
          )}
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            {certAlert === "expired" ? (
              <p className="font-medium">Certificado digital expirado</p>
            ) : certAlert === "urgent" ? (
              <p className="font-medium">
                Certificado expira em {status?.certificateDaysUntilExp} dia(s) — renove já
              </p>
            ) : (
              <p className="font-medium">
                Certificado expira em {status?.certificateDaysUntilExp} dias — planeie a renovação
              </p>
            )}
            <p className="mt-0.5 text-xs opacity-90">
              Envie um novo .pfx/.p12 abaixo (mesmo fluxo de upload). Sem certificado válido a
              emissão de NFS-e falha na prefeitura.
            </p>
          </div>
        </div>
      )}

      {!status?.orgApiEnabled && !status?.isByok && (
        <p className="text-sm text-warning">
          Multi-emitente ainda não activo no servidor (falta NOTAAS_ORG_TOKEN). Pode usar BYOK com
          a sua conta Notaas, ou contactar o suporte Louzada Entregas.
        </p>
      )}

      {status && status.missingSteps.length > 0 && (
        <p className="text-xs text-warning">
          Falta: {status.missingSteps.join(" · ")}
        </p>
      )}

      {status?.apiKeyPrefix && (
        <p className="text-xs text-muted-foreground">
          Chave de emissão: {maskApiKeyPrefix(status.apiKeyPrefix)}
        </p>
      )}

      {status?.certificateValidUntil && !status.isByok && (
        <p className="text-xs text-muted-foreground">
          Certificado válido até{" "}
          {new Date(status.certificateValidUntil).toLocaleDateString("pt-BR")}
          {status.certificateDaysUntilExp != null
            ? ` (${status.certificateDaysUntilExp} dias restantes)`
            : ""}
        </p>
      )}

      {status?.lastError && (
        <p className="text-xs text-destructive dark:text-destructive">{status.lastError}</p>
      )}

      {status?.isByok ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={savingByok}
          onClick={() => void handleClearByok()}
        >
          {savingByok ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Remover BYOK
        </Button>
      ) : (
        <>
          {status?.orgApiEnabled && !status.canEmit && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={syncing}
              onClick={() => void handleSync()}
              className="gap-2"
            >
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Registar emitente no Notaas
            </Button>
          )}

          {status?.orgApiEnabled && (
            <form
              onSubmit={handleUpload}
              className="space-y-3 border-t border-border pt-4 dark:border-border"
            >
              <Label htmlFor="fiscal-cert-file">Certificado digital A1 (.pfx / .p12)</Label>
              <Input
                id="fiscal-cert-file"
                type="file"
                accept=".pfx,.p12"
                onChange={(e) => setCertFile(e.target.files?.[0] ?? null)}
              />
              <div className="space-y-2">
                <Label htmlFor="fiscal-cert-pass">Senha do certificado</Label>
                <Input
                  id="fiscal-cert-pass"
                  type="password"
                  autoComplete="off"
                  value={certPassword}
                  onChange={(e) => setCertPassword(e.target.value)}
                />
              </div>
              <Button type="submit" size="sm" disabled={uploading} className="gap-2">
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {certAlert === "expired" || certAlert === "urgent" || certAlert === "warn"
                  ? "Renovar certificado no Notaas"
                  : "Enviar certificado ao Notaas"}
              </Button>
            </form>
          )}

          <div className="border-t border-border pt-4 dark:border-border">
            {!showByokForm ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-2"
                onClick={() => setShowByokForm(true)}
              >
                <KeyRound className="h-4 w-4" />
                Usar minha conta Notaas (BYOK)
              </Button>
            ) : (
              <form onSubmit={(e) => void handleSaveByok(e)} className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Cole a API key do seu projeto no Notaas (começa com <code>ntaas_</code>). O
                  certificado A1 deve estar activo no painel Notaas. Configure o webhook para{" "}
                  <code className="text-xs">/api/fiscal/webhook/notaas</code> se emitir fora da
                  plataforma.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="fiscal-byok-key">API key Notaas</Label>
                  <Input
                    id="fiscal-byok-key"
                    type="password"
                    autoComplete="off"
                    value={byokKey}
                    onChange={(e) => setByokKey(e.target.value)}
                    placeholder="ntaas_…"
                  />
                </div>
                <label className="flex items-start gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={byokConfirmed}
                    onChange={(e) => setByokConfirmed(e.target.checked)}
                  />
                  Confirmo que o certificado A1 está activo na minha conta Notaas.
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" size="sm" disabled={savingByok} className="gap-2">
                    {savingByok ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                    Guardar BYOK
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowByokForm(false);
                      setByokKey("");
                      setByokConfirmed(false);
                    }}
                  >
                    Cancelar
                  </Button>
                </div>
              </form>
            )}
          </div>
        </>
      )}
    </div>
  );
}
