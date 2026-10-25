"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { isIOSDevice, isPwaStandalone } from "@/lib/pwa-install";
import {
  getWebPushUiStatus,
  subscribeToWebPush,
  unsubscribeFromWebPush,
  type WebPushUiStatus,
} from "@/lib/push-notifications/client";
import { toast } from "sonner";

const IPHONE_TUTORIAL_HREF = "/dashboard/instalar-iphone";

/**
 * Interruptor compacto de push em Meu Perfil.
 * Preferência padrão: ativado (quando o navegador permitir).
 */
export function PushNotificationsToggle() {
  const [status, setStatus] = useState<WebPushUiStatus>("loading");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const ios = isIOSDevice();
    const needsInstall = ios && !isPwaStandalone();
    const next = await getWebPushUiStatus({ iosNeedsInstall: needsInstall });
    setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await refresh();
      if (cancelled) return;
      // Preferência base: ativadas — reativa se o SO já concedeu permissão.
      if (next === "unsubscribed" && Notification.permission === "granted") {
        setBusy(true);
        try {
          await subscribeToWebPush();
          if (!cancelled) await refresh();
        } finally {
          if (!cancelled) setBusy(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const enabled = status === "subscribed";

  const onToggle = useCallback(async () => {
    if (
      busy ||
      status === "loading" ||
      status === "unsupported" ||
      status === "denied" ||
      status === "needs_ios_install"
    ) {
      return;
    }

    setBusy(true);
    try {
      if (enabled) {
        const ok = await unsubscribeFromWebPush();
        if (ok) {
          toast.success("Notificações desativadas neste dispositivo.");
        } else {
          toast.error("Não foi possível desativar. Tente novamente.");
        }
      } else {
        const result = await subscribeToWebPush();
        if (result === "granted") {
          toast.success("Notificações ativadas");
        } else if (result === "denied") {
          toast.error("Permissão negada nas configurações do celular/navegador.");
        } else if (result === "unsupported") {
          toast.error("Push não suportado neste dispositivo.");
        } else {
          toast.error("Não foi possível ativar. Tente novamente.");
        }
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [busy, enabled, refresh, status]);

  const hint =
    status === "denied"
      ? "Bloqueadas no navegador — ative nas configurações do site."
      : status === "needs_ios_install"
        ? "No iPhone, instale o app na tela inicial."
        : status === "unsupported"
          ? "Indisponível neste navegador."
          : "Lembretes de agenda e pontos de ação.";

  return (
    <div
      id="notificacoes-push"
      className="scroll-mt-24 flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 px-3 py-3"
    >
      <div className="min-w-0 flex items-start gap-2.5">
        <Bell className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Notificações push</p>
          <p className="text-xs leading-snug text-muted-foreground">
            {hint}{" "}
            {status === "needs_ios_install" ? (
              <Link
                href={IPHONE_TUTORIAL_HREF}
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                Ver tutorial
              </Link>
            ) : null}
          </p>
        </div>
      </div>

      {status === "needs_ios_install" ? null : (
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={enabled ? "Desativar notificações push" : "Ativar notificações push"}
          disabled={
            busy ||
            status === "loading" ||
            status === "denied" ||
            status === "unsupported"
          }
          onClick={() => void onToggle()}
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
            {busy || status === "loading" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />
            ) : null}
          </span>
        </button>
      )}
    </div>
  );
}
