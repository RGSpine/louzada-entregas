"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Download, Loader2, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  isPwaStandalone,
  pwaInstallTutorialHash,
  shouldOfferPwaInstallOnPath,
} from "@/lib/pwa-install";
import { usePwaInstall } from "@/components/pwa/PwaInstallProvider";

export function PwaInstallBanner() {
  const pathname = usePathname();
  const ctx = usePwaInstall();

  if (!ctx?.visible) return null;
  if (isPwaStandalone()) return null;
  if (!shouldOfferPwaInstallOnPath(pathname)) return null;

  const {
    platform,
    canNativePrompt,
    installing,
    localDevHint,
    install,
    dismiss,
  } = ctx;

  const tutorialHref = `/como-baixar-app${pwaInstallTutorialHash(platform)}`;
  const subtitle = canNativePrompt
    ? "Instalação nativa — um toque e pronto."
    : platform === "ios"
      ? "Gravação otimizada em tela cheia, como um app."
      : "Acesso rápido na tela inicial ou na área de trabalho.";

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-0 z-[90] flex justify-center p-3 sm:p-4",
        "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
      )}
      role="region"
      aria-label="Instalar aplicativo Louzada Entregas"
    >
      <div
        className={cn(
          "pointer-events-auto w-full max-w-xl overflow-hidden rounded-2xl border shadow-[var(--shadow-elevation-3)]",
          "border-primary/30 bg-gradient-to-br from-card via-primary/10 to-muted",
          "dark:border-primary/40 dark:from-card dark:via-primary/15 dark:to-background",
        )}
      >
        <div className="flex items-start gap-3 p-4 sm:gap-4 sm:p-5">
          <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-border bg-[#0f172a] shadow-sm dark:border-border sm:h-14 sm:w-14">
            {/* img nativo — evita otimização Next e garante preview no banner */}
            <img
              src="/icons/icon-192.png"
              alt=""
              width={56}
              height={56}
              className="h-full w-full object-cover"
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <Smartphone className="h-4 w-4 text-primary" aria-hidden />
                  Instale o Louzada Entregas
                </p>
                <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                  {subtitle}
                </p>
                {localDevHint ? (
                  <p className="mt-1 text-[11px] text-warning">
                    Teste local: ícone e sessão estáveis só em produção ou com{" "}
                    <code className="rounded bg-warning/15 px-0.5">
                      pwa:test
                    </code>
                    .
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={dismiss}
                className="min-touch flex shrink-0 items-center justify-center rounded-lg p-1 text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                aria-label="Fechar aviso de instalação"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={installing}
                onClick={() => void install()}
                className="min-touch-inline gap-1.5 bg-primary font-semibold text-primary-foreground hover:bg-primary/90"
              >
                {installing ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Download className="h-4 w-4" aria-hidden />
                )}
                Baixar app
              </Button>
              {!canNativePrompt ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="min-touch-inline border-border"
                  asChild
                >
                  <Link href={tutorialHref}>Como instalar</Link>
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
