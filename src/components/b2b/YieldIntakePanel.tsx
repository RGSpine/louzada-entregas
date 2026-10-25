"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fileExtensionForAudioBlob } from "@/lib/audio-recording-mime";
import { AgendaAudioRecorder } from "@/components/dashboard/AgendaAudioRecorder";
import { UpgradeModal } from "@/components/UpgradeModal";
import { isPremiumFeaturePlanError } from "@/lib/plan-usage-banner";
import { PREMIUM_FEATURES, premiumFeatureUpsellMessage } from "@/lib/premium-feature-upsell";
import type { PlanType } from "@/lib/plan-limits";
import type { YieldDashboardData } from "@/lib/marketplace/yield-schema";
import { cn } from "@/lib/utils";

const slotFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

function formatSlot(iso: string): string {
  return slotFormatter.format(new Date(iso)).replace(", ", " às ");
}

type IntakeResponse = {
  ok?: boolean;
  action?: string | null;
  enabled?: boolean;
  offered?: Array<{ startAt: string }>;
  withdrawn?: Array<{ startAt: string }>;
  windowsSaved?: number;
  windowsDeleted?: number;
  errors?: string[];
  summary?: string | null;
  confidenceOverall?: number;
  dashboard?: YieldDashboardData | null;
  error?: string;
};

type Props = {
  onApplied: (dashboard: YieldDashboardData | null) => void;
  currentPlan?: PlanType;
  maxAudioSeconds?: number;
  className?: string;
};

export function YieldIntakePanel({
  onApplied,
  currentPlan = "PREMIUM",
  maxAudioSeconds = 120,
  className,
}: Props) {
  const [processing, setProcessing] = useState(false);
  const [upsellOpen, setUpsellOpen] = useState(false);
  const intakeAbortRef = useRef<AbortController | null>(null);

  async function submitIntake(formData: FormData) {
    intakeAbortRef.current?.abort();
    const abortController = new AbortController();
    intakeAbortRef.current = abortController;
    setProcessing(true);
    try {
      const res = await fetch("/api/yield/intake", {
        method: "POST",
        body: formData,
        signal: abortController.signal,
      });
      const data = (await res.json()) as IntakeResponse;
      if (!res.ok) {
        toast.error(data.error ?? "Falha ao processar comando de yield.");
        if (isPremiumFeaturePlanError(data.error)) {
          setUpsellOpen(true);
        }
        if (data.summary) toast.message(data.summary);
        return;
      }

      const offered = data.offered ?? [];
      const withdrawn = data.withdrawn ?? [];
      let touched = offered.length + withdrawn.length;
      touched += data.windowsSaved ?? 0;
      touched += data.windowsDeleted ?? 0;
      if (data.enabled !== undefined) touched += 1;

      if (data.enabled === true) {
        toast.success("Gestão Inteligente ativada.");
      } else if (data.enabled === false) {
        toast.success("Gestão Inteligente desativada.");
      }

      if (offered.length === 1) {
        toast.success(`Horário ofertado: ${formatSlot(offered[0]!.startAt)}`);
      } else if (offered.length > 1) {
        toast.success(`${offered.length} horários ofertados no marketplace.`);
      }

      if (withdrawn.length > 0) {
        for (const item of withdrawn) {
          toast.success(`Oferta retirada (${formatSlot(item.startAt)})`);
        }
      }

      if ((data.windowsSaved ?? 0) > 0) {
        toast.success(
          data.windowsSaved === 1
            ? "Janela de horários salva."
            : `${data.windowsSaved} janelas salvas.`,
        );
      }
      if ((data.windowsDeleted ?? 0) > 0) {
        toast.success("Janela removida.");
      }

      if (data.errors?.length) {
        for (const err of data.errors) toast.error(err, { duration: 10_000 });
      }

      if (data.summary && touched === 0 && !data.errors?.length) {
        toast.message(data.summary);
      }

      if (touched > 0 || data.dashboard) {
        onApplied(data.dashboard ?? null);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      toast.error("Erro de rede ao enviar comando de yield.");
    } finally {
      if (intakeAbortRef.current === abortController) {
        intakeAbortRef.current = null;
      }
      setProcessing(false);
    }
  }

  function cancelProcessing() {
    intakeAbortRef.current?.abort();
    intakeAbortRef.current = null;
    setProcessing(false);
    toast.info("Processamento cancelado");
  }

  async function handleAudioReady(blob: Blob) {
    const mime = blob.type.split(";")[0] || "audio/webm";
    const ext = fileExtensionForAudioBlob(mime);
    const fd = new FormData();
    fd.set("mode", "audio");
    fd.set("audio", blob, `yield.${ext}`);
    await submitIntake(fd);
  }

  return (
    <>
      <Card className={cn("clinical-grouped bg-card", className)}>
        <CardHeader>
          <CardTitle>Gestão Inteligente por áudio</CardTitle>
          <CardDescription>
            Grave e pare — o comando atualiza a mesma configuração dos botões.
            Exemplos: ativar regra, ofertar horário, série com repetições,
            retirar oferta ou salvar janela semanal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AgendaAudioRecorder
            maxSeconds={maxAudioSeconds}
            currentPlan={currentPlan}
            disabled={processing}
            processing={processing}
            processingLabel="A processar gestão inteligente…"
            onProcessingCancel={cancelProcessing}
            exampleText='Ex.: "Oferece amanhã às 15h com 30%", "próximas 4 terças às 10h no marketplace", "ativa com 30% faltando 24 horas"'
            onAudioReady={handleAudioReady}
          />
        </CardContent>
      </Card>

      <UpgradeModal
        open={upsellOpen}
        onClose={() => setUpsellOpen(false)}
        title={PREMIUM_FEATURES["yield-management"].title}
        message={premiumFeatureUpsellMessage("yield-management")}
        upgradeLabel="Ver planos e fazer upgrade"
      />
    </>
  );
}
