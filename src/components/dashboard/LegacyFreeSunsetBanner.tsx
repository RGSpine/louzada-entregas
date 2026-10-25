"use client";

import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UpgradeButton } from "@/components/stripe/UpgradeButton";
import { LEGACY_FREE_SUNSET_COPY } from "@/lib/basico-plan";
import { cn } from "@/lib/utils";

type Props = {
  daysRemaining: number;
  className?: string;
};

export function LegacyFreeSunsetBanner({ daysRemaining, className }: Props) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const daysLabel =
    daysRemaining <= 1
      ? "1 dia"
      : `${daysRemaining} dias`;

  return (
    <div
      role="region"
      aria-label="Aviso de transição do plano gratuito"
      className={cn(
        "relative mb-6 rounded-xl border border-primary/30 bg-gradient-to-r from-primary/10 via-clinical/10 to-primary/5 px-4 py-4 shadow-[var(--shadow-elevation-1)] sm:px-5 sm:py-5",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Fechar aviso"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex flex-col gap-4 pr-8 sm:flex-row sm:items-center sm:justify-between sm:pr-10">
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-primary">
            <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
            Novidade no Louzada Entregas — Plano Básico
          </p>
          <p className="text-sm leading-relaxed text-foreground/90">
            {LEGACY_FREE_SUNSET_COPY.replace(
              "Você tem mais 7 dias de acesso livre.",
              `Você tem mais ${daysLabel} de acesso livre.`,
            )}
          </p>
        </div>

        <div className="shrink-0 sm:min-w-[200px]">
          <UpgradeButton planType="BASICO" interval="MONTHLY" className="w-full sm:w-auto">
            Fazer Upgrade Agora
          </UpgradeButton>
        </div>
      </div>
    </div>
  );
}
