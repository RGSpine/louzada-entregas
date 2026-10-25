"use client";

import { useCallback, useRef, useState } from "react";
import { BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fileExtensionForAudioBlob } from "@/lib/audio-recording-mime";
import { AgendaAudioRecorder } from "@/components/dashboard/AgendaAudioRecorder";
import { UpgradeModal } from "@/components/UpgradeModal";
import { isProFeaturePlanError } from "@/lib/plan-usage-banner";
import { PREMIUM_FEATURES, premiumFeatureUpsellMessage } from "@/lib/premium-feature-upsell";
import type { PlanType } from "@/lib/plan-limits";
import { cn } from "@/lib/utils";

type ReportResponse = {
  ok?: boolean;
  answer?: string;
  reportKind?: string;
  transcript?: string | null;
  error?: string;
};

const TEXT_SHORTCUTS: Array<{ label: string; text: string }> = [
  { label: "Quantos amanhã?", text: "quantos pacientes amanhã" },
  { label: "Nomes amanhã", text: "quais os nomes dos pacientes amanhã" },
  { label: "Última semana", text: "quantos atendi na última semana" },
  { label: "Último mês", text: "quantos atendi no último mês" },
];

type Props = {
  outlineBtnClass?: string;
  currentPlan?: PlanType;
  maxAudioSeconds?: number;
  className?: string;
  contentClassName?: string;
};

export function AgendaReportsPanel({
  outlineBtnClass,
  currentPlan = "PREMIUM",
  maxAudioSeconds = 120,
  className,
  contentClassName,
}: Props) {
  const [processing, setProcessing] = useState(false);
  const [lastAnswer, setLastAnswer] = useState<string | null>(null);
  const [proUpsellOpen, setProUpsellOpen] = useState(false);
  const reportAbortRef = useRef<AbortController | null>(null);

  const submitReport = useCallback(async (formData: FormData) => {
    reportAbortRef.current?.abort();
    const abortController = new AbortController();
    reportAbortRef.current = abortController;
    setProcessing(true);
    try {
      const res = await fetch("/api/agenda/report", {
        method: "POST",
        body: formData,
        signal: abortController.signal,
      });
      const data = (await res.json()) as ReportResponse;
      if (!res.ok) {
        toast.error(data.error ?? "Falha ao gerar relatório.");
        if (isProFeaturePlanError(data.error)) {
          setProUpsellOpen(true);
        }
        return;
      }
      if (data.answer) {
        setLastAnswer(data.answer);
        if (data.ok) {
          toast.success(data.answer, { duration: 8000 });
        } else {
          toast.message(data.answer, { duration: 8000 });
        }
      } else if (data.error) {
        toast.error(data.error);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      toast.error("Erro de rede ao pedir relatório.");
    } finally {
      if (reportAbortRef.current === abortController) {
        reportAbortRef.current = null;
      }
      setProcessing(false);
    }
  }, []);

  function cancelProcessing() {
    reportAbortRef.current?.abort();
    reportAbortRef.current = null;
    setProcessing(false);
    toast.info("Processamento cancelado");
  }

  async function runTextReport(text: string) {
    const fd = new FormData();
    fd.set("mode", "text");
    fd.set("text", text);
    await submitReport(fd);
  }

  async function handleAudioReady(blob: Blob) {
    const mime = blob.type.split(";")[0] || "audio/webm";
    const ext = fileExtensionForAudioBlob(mime);
    const fd = new FormData();
    fd.set("mode", "audio");
    fd.set("audio", blob, `relatorio.${ext}`);
    await submitReport(fd);
  }

  return (
    <>
    <Card className={cn("bg-card border-border h-full flex flex-col min-h-0", className)}>
      <CardHeader className="shrink-0">
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5" />
          Relatórios por voz
        </CardTitle>
        <CardDescription>
          Atalhos rápidos ou grave uma pergunta — a resposta aparece ao parar a gravação.
        </CardDescription>
      </CardHeader>
      <CardContent className={cn("space-y-4 flex-1 overflow-y-auto min-h-0", contentClassName)}>
        {lastAnswer && (
          <div
            role="status"
            className="rounded-lg border border-primary/30 bg-primary/10 dark:border-primary/40 dark:bg-primary/15 px-3 py-2 text-sm text-foreground"
          >
            {lastAnswer}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          {TEXT_SHORTCUTS.map((s) => (
            <Button
              key={s.text}
              type="button"
              variant="outline"
              size="sm"
              className={cn(
                outlineBtnClass,
                "!h-auto min-h-9 w-full justify-center text-center whitespace-normal break-words px-2 py-2 text-xs leading-snug",
              )}
              disabled={processing}
              onClick={() => void runTextReport(s.text)}
            >
              {s.label}
            </Button>
          ))}
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <p className="text-sm font-medium text-center">Pergunta por áudio</p>
          <AgendaAudioRecorder
            maxSeconds={maxAudioSeconds}
            currentPlan={currentPlan}
            disabled={processing}
            processing={processing}
            processingLabel="A consultar agenda…"
            onProcessingCancel={cancelProcessing}
            exampleText='Ex.: "Quantos pacientes tenho amanhã?"'
            onAudioReady={handleAudioReady}
          />
        </div>
      </CardContent>
    </Card>

    <UpgradeModal
      open={proUpsellOpen}
      onClose={() => setProUpsellOpen(false)}
      title={PREMIUM_FEATURES["agenda-reports"].title}
      message={premiumFeatureUpsellMessage("agenda-reports")}
      upgradeLabel="Ver planos e fazer upgrade"
    />
    </>
  );
}
