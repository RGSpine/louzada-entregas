"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Loader2, PlayCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isIOSDevice, isPwaStandalone } from "@/lib/pwa-install";
import {
  dismissPushPrompt,
  isPushPromptDismissed,
  isPushSupported,
  subscribeToWebPush,
} from "@/lib/push-notifications/client";
import { toast } from "sonner";

const IPHONE_TUTORIAL_HREF = "/dashboard/instalar-iphone";

function shouldOfferPushOnPath(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname === IPHONE_TUTORIAL_HREF) return false;
  return pathname.startsWith("/dashboard");
}

export function PushNotificationPrompt() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [iosNeedsInstall, setIosNeedsInstall] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    if (!shouldOfferPushOnPath(pathname)) {
      setVisible(false);
      return;
    }

    const ios = isIOSDevice();
    const needsInstall = ios && !isPwaStandalone();
    setIsIos(ios);
    setIosNeedsInstall(needsInstall);

    if (isPushPromptDismissed()) return;
    if (Notification.permission !== "default") return;

    if (needsInstall) {
      setVisible(true);
      return;
    }

    if (!isPushSupported()) return;
    setVisible(true);
  }, [pathname]);

  const dismiss = useCallback(() => {
    dismissPushPrompt();
    setVisible(false);
  }, []);

  const enable = useCallback(async () => {
    setLoading(true);
    try {
      const result = await subscribeToWebPush();
      if (result === "granted") {
        toast.success("Notificações ativadas");
        setVisible(false);
        return;
      }
      if (result === "denied") {
        toast.error("Permissão negada. Ative nas configurações do navegador.");
        setVisible(false);
        return;
      }
      if (result === "unsupported") {
        toast.error("Notificações push não suportadas neste dispositivo.");
        setVisible(false);
        return;
      }
      toast.error("Não foi possível ativar notificações. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }, []);

  if (!visible) return null;

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-0 z-[91] flex justify-center p-3 sm:p-4",
        "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
      )}
      role="region"
      aria-label="Ativar notificações push"
    >
      <div
        className={cn(
          "pointer-events-auto w-full max-w-xl overflow-hidden rounded-2xl border shadow-[var(--shadow-elevation-3)]",
          "border-clinical/30 bg-gradient-to-br from-card via-clinical/10 to-muted",
          "dark:border-clinical/40 dark:from-card dark:via-clinical/15 dark:to-background",
        )}
      >
        <div className="flex items-start gap-3 p-4 sm:gap-4 sm:p-5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-clinical/30 bg-clinical/15 sm:h-14 sm:w-14">
            <Bell className="h-6 w-6 text-clinical" aria-hidden />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {iosNeedsInstall ? "Instale o app para lembretes" : "Ativar lembretes push"}
                </p>
                <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                  {iosNeedsInstall
                    ? "No iPhone, adicione o Louzada Entregas à tela inicial antes de ativar notificações de agenda e pontos de ação."
                    : "Pontos de ação das evoluções e consultas da agenda — lembretes 24h e 1h antes."}
                </p>
              </div>
              <button
                type="button"
                onClick={dismiss}
                className="min-touch flex shrink-0 items-center justify-center rounded-lg p-1 text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                aria-label="Fechar aviso de notificações"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {iosNeedsInstall ? (
                <Button
                  type="button"
                  size="sm"
                  className="min-touch-inline gap-1.5 bg-clinical font-semibold text-clinical-foreground hover:bg-clinical/90"
                  asChild
                >
                  <Link href={IPHONE_TUTORIAL_HREF}>
                    <PlayCircle className="h-4 w-4" aria-hidden />
                    Ver tutorial (iPhone)
                  </Link>
                </Button>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    disabled={loading}
                    onClick={() => void enable()}
                    className="min-touch-inline w-fit gap-1.5 bg-clinical font-semibold text-clinical-foreground hover:bg-clinical/90"
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Bell className="h-4 w-4" aria-hidden />
                    )}
                    Ativar
                  </Button>
                  {isIos ? (
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      iPhone: o app precisa estar na tela inicial para receber lembretes.
                    </p>
                  ) : null}
                </div>
              )}

              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="min-touch-inline text-muted-foreground"
                onClick={dismiss}
              >
                Agora não
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
