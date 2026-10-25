"use client";

import { useState } from "react";
import { Ban, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  cancelMySubscription,
  type CancelMySubscriptionResult,
} from "@/app/actions/billing";
import { cn } from "@/lib/utils";

type Props = {
  /** Quando true, exibe o painel (assinatura e/ou customer Stripe canceláveis). */
  hasStripeSubscription: boolean;
  currentPeriodEnd?: Date | null;
  className?: string;
  /**
   * Só mostra o visual do botão (dono/parceria). Não chama a Stripe —
   * útil para o proprietário validar a UI.
   */
  previewOnly?: boolean;
  /**
   * Atualiza o estado local do plano (obrigatório em páginas client que
   * cacheiam `getCurrentPlan` — senão o banner/painel ficam stale).
   */
  onCanceled?: (result: CancelMySubscriptionResult) => void | Promise<void>;
};

function formatPeriodEnd(date: Date | null | undefined): string {
  if (!date) return "o fim do período já pago";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(date));
}

const cancelBtnClass =
  "h-9 border-destructive bg-destructive text-white hover:bg-destructive/90 " +
  "dark:bg-background dark:text-destructive dark:hover:bg-destructive/10 dark:border-destructive";

/**
 * Cancela a assinatura na Stripe a partir do Louzada Entregas (sem apagar a conta).
 * Trial → cancelamento imediato; plano pago → fim no término do período.
 */
export function CancelSubscriptionPanel({
  hasStripeSubscription,
  currentPeriodEnd,
  className,
  previewOnly = false,
  onCanceled,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (!hasStripeSubscription && !previewOnly) return null;

  async function handleCancel() {
    if (previewOnly) {
      toast.info(
        "Prévia do botão: na sua conta vitalícia não há assinatura Stripe. Assinantes pagos veem o cancelamento real aqui.",
      );
      setConfirming(false);
      return;
    }

    setLoading(true);
    try {
      const result = await cancelMySubscription();
      if (!result.success) {
        toast.error(result.error ?? "Não foi possível cancelar a assinatura.");
        return;
      }
      toast.success(result.message ?? "Assinatura cancelada.");
      setConfirming(false);
      if (onCanceled) {
        await onCanceled(result);
      } else {
        router.refresh();
        router.push("/dashboard/planos?billing=updated");
      }
    } catch {
      toast.error("Erro inesperado ao cancelar. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-destructive/35 bg-destructive/5 px-3 py-3 dark:bg-destructive/10",
        className,
      )}
    >
      {previewOnly ? (
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-destructive/80">
          Prévia (sua conta não cancela na Stripe)
        </p>
      ) : null}
      {!confirming ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <p className="min-w-0 text-xs leading-snug text-muted-foreground sm:text-sm">
            Encerrar cobrança na Stripe (conta permanece). Em teste, sem cobrança;
            em plano pago, acesso até {formatPeriodEnd(currentPeriodEnd)}.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn("w-full shrink-0 sm:w-auto", cancelBtnClass)}
            onClick={() => setConfirming(true)}
          >
            <Ban className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Cancelar assinatura
          </Button>
        </div>
      ) : (
        <div className="space-y-2.5">
          <p className="text-xs leading-snug text-foreground sm:text-sm">
            {previewOnly
              ? "Isto é só a prévia do fluxo. Confirmar não altera a Stripe na conta vitalícia."
              : `Confirma o cancelamento? Em teste, encerra agora. Em plano pago, acesso até ${formatPeriodEnd(currentPeriodEnd)}.`}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1 border-border"
              disabled={loading}
              onClick={() => setConfirming(false)}
            >
              Voltar
            </Button>
            <Button
              type="button"
              size="sm"
              className={cn("flex-1", cancelBtnClass)}
              disabled={loading}
              onClick={() => void handleCancel()}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                  Cancelando…
                </>
              ) : (
                "Confirmar"
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
