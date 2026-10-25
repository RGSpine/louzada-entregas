"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Loader2, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { updateEvolutionDeliveryPreferences } from "@/app/actions/profile";

type EvolutionDeliveryPreferencesCardProps = {
  autoDownloadNewEvolution: boolean;
  emailNewEvolution: boolean;
  onChange?: (next: {
    autoDownloadNewEvolution: boolean;
    emailNewEvolution: boolean;
  }) => void;
};

function PreferenceSwitch({
  enabled,
  busy,
  ariaLabel,
  onToggle,
}: {
  enabled: boolean;
  busy: boolean;
  ariaLabel: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={ariaLabel}
      disabled={busy}
      onClick={onToggle}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-full transition-colors min-touch",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        enabled ? "bg-primary" : "bg-muted-foreground/35",
      )}
    >
      <span
        className={cn(
          "pointer-events-none absolute top-0.5 left-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-sm transition-transform",
          enabled && "translate-x-5",
        )}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />
        ) : null}
      </span>
    </button>
  );
}

/**
 * Preferências de entrega do PDF ao gerar uma nova evolução.
 * Salvamento no paciente (histórico/pasta) permanece sempre ativo.
 */
export function EvolutionDeliveryPreferencesCard({
  autoDownloadNewEvolution,
  emailNewEvolution,
  onChange,
}: EvolutionDeliveryPreferencesCardProps) {
  const [downloadOn, setDownloadOn] = useState(autoDownloadNewEvolution);
  const [emailOn, setEmailOn] = useState(emailNewEvolution);
  const [busyKey, setBusyKey] = useState<"download" | "email" | null>(null);

  useEffect(() => {
    setDownloadOn(autoDownloadNewEvolution);
    setEmailOn(emailNewEvolution);
  }, [autoDownloadNewEvolution, emailNewEvolution]);

  const persist = useCallback(
    async (
      next: { autoDownloadNewEvolution: boolean; emailNewEvolution: boolean },
      key: "download" | "email",
      rollback: { autoDownloadNewEvolution: boolean; emailNewEvolution: boolean },
    ) => {
      setBusyKey(key);
      try {
        const result = await updateEvolutionDeliveryPreferences(next);
        if (!result.success) {
          toast.error(result.error || "Não foi possível salvar a preferência.");
          setDownloadOn(rollback.autoDownloadNewEvolution);
          setEmailOn(rollback.emailNewEvolution);
          return;
        }
        onChange?.(next);
        toast.success("Preferência salva.");
      } catch {
        toast.error("Não foi possível salvar a preferência.");
        setDownloadOn(rollback.autoDownloadNewEvolution);
        setEmailOn(rollback.emailNewEvolution);
      } finally {
        setBusyKey(null);
      }
    },
    [onChange],
  );

  const toggleDownload = () => {
    if (busyKey) return;
    const rollback = {
      autoDownloadNewEvolution: downloadOn,
      emailNewEvolution: emailOn,
    };
    const next = {
      autoDownloadNewEvolution: !downloadOn,
      emailNewEvolution: emailOn,
    };
    setDownloadOn(next.autoDownloadNewEvolution);
    void persist(next, "download", rollback);
  };

  const toggleEmail = () => {
    if (busyKey) return;
    const rollback = {
      autoDownloadNewEvolution: downloadOn,
      emailNewEvolution: emailOn,
    };
    const next = {
      autoDownloadNewEvolution: downloadOn,
      emailNewEvolution: !emailOn,
    };
    setEmailOn(next.emailNewEvolution);
    void persist(next, "email", rollback);
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 px-3 py-3">
      <div>
        <p className="text-sm font-medium text-foreground">Entrega do PDF da evolução</p>
        <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
          Ao gerar uma evolução, ela sempre é salva na pasta do paciente. Download no dispositivo e
          envio por e-mail são opcionais.
        </p>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-3">
        <div className="min-w-0 flex items-start gap-2.5">
          <Download className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Baixar no dispositivo</p>
            <p className="text-xs leading-snug text-muted-foreground">
              Inicia o download automático do PDF ao finalizar a evolução.
            </p>
          </div>
        </div>
        <PreferenceSwitch
          enabled={downloadOn}
          busy={busyKey === "download"}
          ariaLabel={
            downloadOn
              ? "Desativar download automático do PDF"
              : "Ativar download automático do PDF"
          }
          onToggle={toggleDownload}
        />
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-3">
        <div className="min-w-0 flex items-start gap-2.5">
          <Mail className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Enviar por e-mail</p>
            <p className="text-xs leading-snug text-muted-foreground">
              Envia o PDF para o e-mail cadastrado na sua conta.
            </p>
          </div>
        </div>
        <PreferenceSwitch
          enabled={emailOn}
          busy={busyKey === "email"}
          ariaLabel={
            emailOn
              ? "Desativar envio do PDF por e-mail"
              : "Ativar envio do PDF por e-mail"
          }
          onToggle={toggleEmail}
        />
      </div>
    </div>
  );
}
