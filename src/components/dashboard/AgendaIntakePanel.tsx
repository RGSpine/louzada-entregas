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
import { cn } from "@/lib/utils";

type SuggestedSlotDto = { startUtc: string; endUtc: string; label: string };

type IntakeResponse = {
  ok?: boolean;
  action?: "create" | "reschedule" | "cancel" | "no_show" | "rename" | "yield" | null;
  created?: Array<{ id: string; patientName: string; startAt: string; endAt: string }>;
  rescheduled?: Array<{
    id: string;
    patientName: string;
    previousStartAt: string;
    startAt: string;
    endAt: string;
  }>;
  cancelled?: Array<{ id: string; patientName: string; startAt: string }>;
  renamed?: Array<{
    id: string;
    previousName: string;
    patientName: string;
    startAt: string;
  }>;
  noShows?: Array<{
    id: string;
    patientName: string;
    startAt: string;
    noShowReason: string;
  }>;
  errors?: string[];
  issues?: Array<{ message: string; suggestedSlots?: SuggestedSlotDto[] }>;
  newPatientNames?: string[];
  summary?: string | null;
  confidenceOverall?: number;
  error?: string;
};

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

type Props = {
  onBooked: () => void;
  currentPlan?: PlanType;
  maxAudioSeconds?: number;
  className?: string;
  contentClassName?: string;
};

export function AgendaIntakePanel({
  onBooked,
  currentPlan = "PREMIUM",
  maxAudioSeconds = 120,
  className,
  contentClassName,
}: Props) {
  const [processing, setProcessing] = useState(false);
  const [proUpsellOpen, setProUpsellOpen] = useState(false);
  const intakeAbortRef = useRef<AbortController | null>(null);

  async function submitIntake(formData: FormData) {
    intakeAbortRef.current?.abort();
    const abortController = new AbortController();
    intakeAbortRef.current = abortController;
    setProcessing(true);
    try {
      const res = await fetch("/api/agenda/intake", {
        method: "POST",
        body: formData,
        signal: abortController.signal,
      });
      const data = (await res.json()) as IntakeResponse;
      if (!res.ok) {
        toast.error(data.error ?? "Falha ao processar agendamento.");
        if (isPremiumFeaturePlanError(data.error)) {
          setProUpsellOpen(true);
        }
        if (data.summary) toast.message(data.summary);
        return;
      }
      const created = data.created ?? [];
      const rescheduled = data.rescheduled ?? [];
      const cancelled = data.cancelled ?? [];
      const renamed = data.renamed ?? [];
      const noShows = data.noShows ?? [];
      const touched =
        created.length +
        rescheduled.length +
        cancelled.length +
        renamed.length +
        noShows.length;

      if (created.length > 0) {
        toast.success(
          created.length === 1
            ? `Marcação criada: ${created[0]!.patientName} — ${formatSlot(created[0]!.startAt)}`
            : `${created.length} marcações criadas.`,
        );
        const newNames = data.newPatientNames?.filter(Boolean) ?? [];
        if (newNames.length > 0) {
          toast.message(
            newNames.length === 1
              ? `Nome novo na agenda (sem ficha clínica): ${newNames[0]}.`
              : `Nomes novos na agenda (sem ficha clínica): ${newNames.join(", ")}.`,
          );
        }
      }

      if (rescheduled.length > 0) {
        for (const item of rescheduled) {
          toast.success(
            `${item.patientName} remarcado: ${formatSlot(item.previousStartAt)} → ${formatSlot(item.startAt)}`,
            { duration: 10_000 },
          );
        }
      }

      if (cancelled.length > 0) {
        for (const item of cancelled) {
          toast.success(
            `${item.patientName} desmarcado (${formatSlot(item.startAt)})`,
            { duration: 10_000 },
          );
        }
      }

      if (renamed.length > 0) {
        for (const item of renamed) {
          toast.success(
            `Nome atualizado: ${item.previousName} → ${item.patientName} (${formatSlot(item.startAt)})`,
            { duration: 10_000 },
          );
        }
      }

      if (noShows.length > 0) {
        for (const item of noShows) {
          toast.success(
            `Falta registrada: ${item.patientName} (${formatSlot(item.startAt)}) — ${item.noShowReason}`,
            { duration: 10_000 },
          );
        }
      }

      if (touched > 0) {
        onBooked();
      }

      if (data.errors?.length) {
        for (const err of data.errors) toast.error(err, { duration: 10_000 });
      }
      const slotHints = data.issues
        ?.flatMap((i) => i.suggestedSlots?.map((s) => s.label) ?? [])
        .filter(Boolean);
      if (slotHints?.length) {
        toast.message(`Horários livres sugeridos: ${[...new Set(slotHints)].join(", ")}`, {
          duration: 12_000,
        });
      }
      if (data.summary && touched === 0 && !data.errors?.length) {
        toast.message(data.summary);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      toast.error("Erro de rede ao enviar agendamento.");
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
    fd.set("audio", blob, `agenda.${ext}`);
    await submitIntake(fd);
  }

  return (
    <>
      <Card
        className={cn(
          "bg-card border-border h-full flex flex-col min-h-0",
          className,
        )}
      >
        <CardHeader className="shrink-0">
          <CardTitle>Agenda por áudio</CardTitle>
          <CardDescription>
            Grave e pare — o comando é processado automaticamente. Dá para marcar
            («agende a Ana amanhã às 9h»), remarcar («remarque a Ana para sexta às 16h»),
            desmarcar («desmarque a Ana de amanhã») e registrar falta
            («a Ana não vem amanhã, imprevisto familiar»). Conflitos são validados no servidor.
          </CardDescription>
        </CardHeader>
        <CardContent className={cn("space-y-5 flex-1 overflow-y-auto min-h-0", contentClassName)}>
          <AgendaAudioRecorder
            maxSeconds={maxAudioSeconds}
            currentPlan={currentPlan}
            disabled={processing}
            processing={processing}
            processingLabel="A processar agendamento…"
            onProcessingCancel={cancelProcessing}
            exampleText='Ex.: "Marque terça e quinta às 19:30 o Eric", "Remarque a Ana para sexta às 16h" ou "A Karina não vem amanhã, imprevisto familiar"'
            onAudioReady={handleAudioReady}
          />
        </CardContent>
      </Card>

      <UpgradeModal
        open={proUpsellOpen}
        onClose={() => setProUpsellOpen(false)}
        title={PREMIUM_FEATURES["voice-agenda"].title}
        message={premiumFeatureUpsellMessage("voice-agenda")}
        upgradeLabel="Ver planos e fazer upgrade"
      />
    </>
  );
}
