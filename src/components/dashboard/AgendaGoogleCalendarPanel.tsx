"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarDays, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  disconnectGoogleCalendar,
  getAgendaGoogleCalendarStatus,
  importGoogleCalendarToAgenda,
  requestGoogleCalendarManualSync,
  runFullGoogleCalendarSync,
} from "@/app/actions/google-calendar";
import { cn } from "@/lib/utils";
import { GoogleMarkIcon } from "@/components/icons/GoogleMarkIcon";

type Props = {
  outlineBtnClass?: string;
  onSynced?: () => void;
  className?: string;
};

export function AgendaGoogleCalendarPanel({
  outlineBtnClass,
  onSynced,
  className,
}: Props) {
  const searchParams = useSearchParams();
  const [gcalConnected, setGcalConnected] = useState(false);
  const [gcalScope, setGcalScope] = useState(false);
  const [gcalNeedsReconnect, setGcalNeedsReconnect] = useState(false);
  const [gcalOAuthConfigured, setGcalOAuthConfigured] = useState(true);
  const [gcalIntegrationEnabled, setGcalIntegrationEnabled] = useState(false);
  const [gcalMessage, setGcalMessage] = useState("");
  const [gcalLastSynced, setGcalLastSynced] = useState<string | null>(null);
  const [gcalSyncing, setGcalSyncing] = useState(false);
  const [connectPath, setConnectPath] = useState("/api/integrations/google/connect");
  const [manualSyncEligible, setManualSyncEligible] = useState(false);
  const [manualSyncPending, setManualSyncPending] = useState(false);
  const [manualSyncEmail, setManualSyncEmail] = useState("");
  const [googleEmailInput, setGoogleEmailInput] = useState("");
  const [manualSyncSubmitting, setManualSyncSubmitting] = useState(false);

  const loadGcal = useCallback(async () => {
    const res = await getAgendaGoogleCalendarStatus();
    if (!res.success) return;
    setGcalOAuthConfigured(res.oauthConfigured !== false);
    setGcalIntegrationEnabled(res.integrationEnabled !== false);
    setGcalConnected(!!res.connected);
    setGcalScope(!!res.hasCalendarScope);
    setGcalNeedsReconnect(!!res.needsReconnect);
    setGcalMessage(res.message ?? "");
    setGcalLastSynced(res.lastSyncedAt ?? null);
    if (res.connectPath) setConnectPath(res.connectPath);
    setManualSyncEligible(!!res.manualSyncEligible);
    setManualSyncPending(!!res.manualSyncPending);
    setManualSyncEmail(res.manualSyncEmail ?? "");
  }, []);

  async function handleImportGoogle() {
    setGcalSyncing(true);
    try {
      const res = await importGoogleCalendarToAgenda();
      if (!res.success) {
        toast.error(res.error ?? "Falha ao importar.");
        return;
      }
      const parts = [
        res.imported ? `${res.imported} importada(s)` : null,
        res.updated ? `${res.updated} atualizada(s)` : null,
        res.skipped ? `${res.skipped} ignorada(s)` : null,
      ].filter(Boolean);
      toast.success(parts.length > 0 ? `Google Agenda: ${parts.join(", ")}.` : "Nada novo para importar.");
      if (res.errors?.length) {
        const msg = res.errors.slice(0, 3).join(" · ");
        toast.message(msg, { duration: 10_000 });
        if (msg.toLowerCase().includes("reconectar")) void loadGcal();
      }
      onSynced?.();
      void loadGcal();
    } finally {
      setGcalSyncing(false);
    }
  }

  async function handleFullSync() {
    setGcalSyncing(true);
    try {
      const res = await runFullGoogleCalendarSync();
      if (!res.success) {
        toast.error(res.error ?? "Falha na sincronização.");
        return;
      }
      toast.success(
        `Sync concluída: ${res.imported ?? 0} import., ${res.updated ?? 0} atual., ${res.pushed ?? 0} enviada(s) ao Google.`,
      );
      if (res.errors?.length) {
        const msg = res.errors.slice(0, 3).join(" · ");
        toast.message(msg, { duration: 10_000 });
        if (
          msg.toLowerCase().includes("reconectar") ||
          msg.toLowerCase().includes("invalid authentication")
        ) {
          void loadGcal();
        }
      }
      onSynced?.();
      void loadGcal();
    } finally {
      setGcalSyncing(false);
    }
  }

  async function handleDisconnectGoogle() {
    const res = await disconnectGoogleCalendar();
    if (!res.success) {
      toast.error(res.error ?? "Não foi possível desligar o Google Agenda.");
      return;
    }
    toast.success("Google Agenda desligado. Clique em Conectar Google para autorizar de novo.");
    void loadGcal();
  }

  async function handleManualGoogleSyncSubmit(e: FormEvent) {
    e.preventDefault();
    const email = googleEmailInput.trim();
    if (!email) {
      toast.error("Informe o e-mail da sua conta Google.");
      return;
    }
    setManualSyncSubmitting(true);
    try {
      const res = await requestGoogleCalendarManualSync(email);
      if (!res.success) {
        toast.error(res.error ?? "Não foi possível enviar o pedido.");
        return;
      }
      toast.success(res.message ?? "Pedido enviado.");
      void loadGcal();
    } finally {
      setManualSyncSubmitting(false);
    }
  }

  const showGoogleConnect =
    gcalOAuthConfigured && (!gcalConnected || !gcalScope || gcalNeedsReconnect);
  const showGoogleSync =
    gcalOAuthConfigured && gcalConnected && gcalScope && !gcalNeedsReconnect;

  const statusLabel = !gcalOAuthConfigured
    ? "Indisponível"
    : showGoogleSync
      ? "Ligado"
      : gcalNeedsReconnect
        ? "Reconectar"
        : manualSyncPending
          ? "Em análise"
          : "Não ligado";

  useEffect(() => {
    void loadGcal();
  }, [loadGcal]);

  useEffect(() => {
    const google = searchParams.get("google");
    if (!google) return;
    if (google === "connected") {
      toast.success("Conta Google ligada. Novas marcações podem ser enviadas ao Google Agenda.");
      void loadGcal();
    } else if (google === "unconfigured") {
      toast.error("Integração Google não está configurada no servidor.");
    } else if (google === "no_user") {
      toast.error("Utilizador não encontrado. Tente iniciar sessão novamente.");
    } else if (google === "integration_disabled") {
      toast.message(
        "A ligação com o Google Agenda ainda está em fase de testes internos. Em breve estará disponível.",
        { duration: 8000 },
      );
    }
  }, [searchParams, loadGcal]);

  return (
    <section
      className={cn(
        "mb-6 rounded-xl border border-border bg-white p-4 shadow-sm dark:border-border dark:bg-card",
        className,
      )}
      aria-label="Integração Google Agenda"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <CalendarDays className="h-5 w-5 shrink-0 text-primary" aria-hidden />
            <h2 className="text-sm font-semibold text-foreground">
              Google Agenda (opcional)
            </h2>
            <Badge
              variant={showGoogleSync ? "default" : "outline"}
              className={cn(
                "text-[10px]",
                gcalNeedsReconnect ? "border-warning text-warning" : undefined,
                manualSyncPending && !showGoogleSync ? "border-clinical text-clinical" : undefined,
              )}
            >
              {statusLabel}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {manualSyncPending
              ? "A sincronização será feita em até 12hrs."
              : gcalMessage || "Conecte a conta Google para sincronizar a agenda."}
          </p>
          {gcalLastSynced && (
            <p className="text-[11px] text-muted-foreground">
              Última sync automática:{" "}
              {new Date(gcalLastSynced).toLocaleString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          )}
          {manualSyncPending && manualSyncEmail ? (
            <p className="text-[11px] text-muted-foreground">E-mail informado: {manualSyncEmail}</p>
          ) : null}
        </div>

        <div className="flex w-full flex-col items-center justify-center gap-2 sm:w-auto sm:min-w-[200px] sm:px-4 md:px-8">
          {gcalIntegrationEnabled ? (
            <>
              {showGoogleConnect && (
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    outlineBtnClass,
                    "h-10 min-w-[200px] justify-center gap-2.5 px-5 text-sm font-medium",
                  )}
                  asChild
                >
                  <a href={connectPath}>
                    <GoogleMarkIcon className="h-[18px] w-[18px]" />
                    <span>{gcalNeedsReconnect ? "Reconectar Google" : "Conectar Google"}</span>
                  </a>
                </Button>
              )}
              {showGoogleSync && (
                <div className="flex w-full flex-col items-center gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(outlineBtnClass, "w-full justify-center sm:w-auto")}
                    disabled={gcalSyncing}
                    onClick={() => void handleImportGoogle()}
                  >
                    {gcalSyncing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <>
                        <GoogleMarkIcon className="h-4 w-4" />
                        <span>Importar do Google</span>
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(outlineBtnClass, "w-full justify-center sm:w-auto")}
                    disabled={gcalSyncing}
                    onClick={() => void handleFullSync()}
                  >
                    Sincronizar tudo
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full text-xs text-muted-foreground sm:w-auto"
                    disabled={gcalSyncing}
                    onClick={() => void handleDisconnectGoogle()}
                  >
                    Desligar
                  </Button>
                </div>
              )}
            </>
          ) : manualSyncEligible && !manualSyncPending ? (
            <form
              className="flex w-full flex-col gap-2 sm:min-w-[280px]"
              onSubmit={(e) => void handleManualGoogleSyncSubmit(e)}
            >
              <div className="space-y-1">
                <Label htmlFor="agenda-google-calendar-email" className="text-xs text-muted-foreground">
                  E-mail da conta Google
                </Label>
                <Input
                  id="agenda-google-calendar-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="seuemail@gmail.com"
                  value={googleEmailInput}
                  onChange={(e) => setGoogleEmailInput(e.target.value)}
                  disabled={manualSyncSubmitting}
                  className="h-9 text-sm"
                />
              </div>
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className={cn(outlineBtnClass, "w-full justify-center text-center")}
                disabled={manualSyncSubmitting}
              >
                {manualSyncSubmitting ? "Enviando…" : "Solicitar sincronização"}
              </Button>
            </form>
          ) : !manualSyncEligible ? (
            <p className="text-center text-xs text-warning dark:text-warning">
              Disponível nos planos Profissional e Premium.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
