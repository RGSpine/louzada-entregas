"use client";

import { useState } from "react";
import { ArrowDownCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { PlanTier } from "@/lib/plan-tier";

type Props = {
  targetPlan: Extract<PlanTier, "BASICO" | "PROFISSIONAL">;
  currentPeriodEnd?: Date | null;
  className?: string;
};

function formatPeriodEnd(date: Date | null | undefined): string {
  if (!date) return "o fim do período já pago";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(date));
}

export function DowngradeButton({ targetPlan, currentPeriodEnd, className }: Props) {
  const [loading, setLoading] = useState(false);

  const label =
    targetPlan === "BASICO" ? "Downgrade para Básico" : "Downgrade para Profissional";

  async function handleDowngrade() {
    const confirmed = window.confirm(
      `Confirmar ${label}?\n\nVocê continuará com os benefícios do plano atual até ${formatPeriodEnd(
        currentPeriodEnd,
      )}. Não há estorno do valor já pago.`,
    );
    if (!confirmed) return;

    setLoading(true);
    try {
      const res = await fetch("/api/stripe/downgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPlan }),
      });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Não foi possível agendar o downgrade.");
        return;
      }
      toast.success(data.message ?? "Downgrade agendado com sucesso.");
    } catch {
      toast.error("Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => void handleDowngrade()}
      disabled={loading}
      className={
        className ??
        "w-full border-border bg-card text-foreground hover:bg-muted"
      }
    >
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Agendando…
        </>
      ) : (
        <>
          <ArrowDownCircle className="h-4 w-4" />
          {label}
        </>
      )}
    </Button>
  );
}
