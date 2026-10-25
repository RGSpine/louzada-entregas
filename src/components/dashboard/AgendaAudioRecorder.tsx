"use client";

import { useRef, useState } from "react";
import { Loader2, Mic, Pause, Play, Square, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RecordingDurationMarker } from "@/components/dashboard/RecordingDurationMarker";
import { PlanLimitUpgradeModal } from "@/components/PlanLimitUpgradeModal";
import {
  getSupportedRecorderMimeOptions,
} from "@/lib/audio-recording-mime";
import {
  isMediaRecorderPauseSupported,
  releaseMediaStream,
  startMediaRecorder,
  stopMediaRecorderSafely,
} from "@/lib/media-recorder-safe";
import { formatAudioLimitPhraseFromSeconds } from "@/lib/plan-limits";
import type { PlanType } from "@/lib/plan-limits";
import { cn } from "@/lib/utils";

export type AgendaAudioRecorderProps = {
  maxSeconds?: number;
  disabled?: boolean;
  processing?: boolean;
  processingLabel?: string;
  onProcessingCancel?: () => void;
  exampleText?: string;
  /** Quando definido, o teto é deste uso (não abre o modal de upgrade de plano). */
  limitDescription?: string;
  onAudioReady: (blob: Blob, durationSec: number) => void | Promise<void>;
  /** Plano atual — usado no modal de upgrade ao atingir o teto de gravação. */
  currentPlan?: PlanType;
};

/**
 * Gravação de áudio no estilo Nova Evolução (botão circular, pausa, interromper).
 * Ao parar com sucesso, chama `onAudioReady` automaticamente — sem botão «Processar».
 */
export function AgendaAudioRecorder({
  maxSeconds = 120,
  disabled = false,
  processing = false,
  processingLabel = "Processando…",
  onProcessingCancel,
  exampleText,
  limitDescription,
  onAudioReady,
  currentPlan = "PREMIUM",
}: AgendaAudioRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [pauseSupported, setPauseSupported] = useState(false);
  const [audioLimitModalOpen, setAudioLimitModalOpen] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);
  const discardRef = useRef(false);
  const mimeRef = useRef("audio/webm");

  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function resetRecordingUi() {
    clearTimer();
    recorderRef.current = null;
    releaseMediaStream(streamRef.current);
    streamRef.current = null;
    chunksRef.current = [];
    elapsedRef.current = 0;
    setElapsed(0);
    setRecording(false);
    setPaused(false);
  }

  function notifyRecordingLimitReached() {
    toast.warning("Limite de gravação atingido", {
      description:
        limitDescription ??
        `Seu plano permite até ${formatAudioLimitPhraseFromSeconds(maxSeconds)} por gravação.`,
    });
    if (!limitDescription && currentPlan !== "PREMIUM") {
      setAudioLimitModalOpen(true);
    }
  }

  function startTimer(recorder: MediaRecorder) {
    clearTimer();
    timerRef.current = setInterval(() => {
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);
      if (elapsedRef.current >= maxSeconds) {
        notifyRecordingLimitReached();
        void finishRecording(recorder);
      }
    }, 1000);
  }

  async function finishRecording(recorder: MediaRecorder) {
    clearTimer();
    setPaused(false);
    const stopped = await stopMediaRecorderSafely(recorder);
    if (!stopped) {
      resetRecordingUi();
      toast.error("Não foi possível finalizar a gravação.", {
        description: "Tente gravar de novo.",
      });
    }
  }

  async function startRecording() {
    if (recording || processing || disabled) return;
    try {
      discardRef.current = false;
      chunksRef.current = [];
      elapsedRef.current = 0;
      setElapsed(0);
      setPaused(false);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const opts = getSupportedRecorderMimeOptions();
      const recorder = opts ? new MediaRecorder(stream, opts) : new MediaRecorder(stream);
      setPauseSupported(isMediaRecorderPauseSupported(recorder));

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        clearTimer();
        recorderRef.current = null;
        releaseMediaStream(streamRef.current);
        streamRef.current = null;
        setRecording(false);
        setPaused(false);

        if (discardRef.current) {
          discardRef.current = false;
          chunksRef.current = [];
          elapsedRef.current = 0;
          setElapsed(0);
          return;
        }

        const mime =
          recorder.mimeType.split(";")[0]?.trim().toLowerCase() ||
          opts?.mimeType.split(";")[0]?.trim().toLowerCase() ||
          "audio/webm";
        mimeRef.current = mime || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mimeRef.current });
        const duration = elapsedRef.current;
        chunksRef.current = [];
        elapsedRef.current = 0;
        setElapsed(0);

        if (blob.size === 0) {
          toast.error("Nenhum áudio captado. Tente gravar de novo.");
          return;
        }
        void Promise.resolve(onAudioReady(blob, duration));
      };

      startMediaRecorder(recorder);
      recorderRef.current = recorder;
      setRecording(true);
      startTimer(recorder);
    } catch {
      resetRecordingUi();
      toast.error("Não foi possível aceder ao microfone.");
    }
  }

  function stopAndProcess() {
    const rec = recorderRef.current;
    if (!rec) return;
    void finishRecording(rec);
  }

  function pauseRecording() {
    const rec = recorderRef.current;
    if (!rec || rec.state !== "recording") return;
    if (!isMediaRecorderPauseSupported(rec)) {
      toast.error("Pausa não é suportada neste dispositivo.", {
        description: "Use o botão vermelho para finalizar ou interrompa a gravação.",
      });
      return;
    }
    try {
      rec.pause();
    } catch {
      toast.error("Não foi possível pausar a gravação.");
      return;
    }
    clearTimer();
    setPaused(true);
  }

  function resumeRecording() {
    const rec = recorderRef.current;
    if (!rec || rec.state !== "paused") {
      setPaused(false);
      return;
    }
    try {
      rec.resume();
    } catch {
      toast.error("Não foi possível retomar a gravação.");
      return;
    }
    setPaused(false);
    startTimer(rec);
  }

  async function discardRecording() {
    discardRef.current = true;
    clearTimer();
    setPaused(false);
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      const stopped = await stopMediaRecorderSafely(rec);
      if (!stopped) {
        discardRef.current = false;
        resetRecordingUi();
      }
    } else {
      resetRecordingUi();
    }
    toast.info("Gravação interrompida", {
      description: "O áudio foi descartado. Pode gravar de novo quando quiser.",
    });
  }

  const busy = disabled || processing;

  return (
    <>
    <div className="flex flex-col items-center gap-3 w-full">
      {exampleText && !recording && !processing && (
        <p className="text-xs text-muted-foreground text-center w-full">{exampleText}</p>
      )}

      {processing ? (
        <div className="flex flex-col items-center gap-3 py-2">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/90 shadow-lg">
            <Loader2 className="h-10 w-10 animate-spin" aria-hidden />
          </div>
          <p className="text-sm font-medium text-muted-foreground dark:text-muted-foreground">{processingLabel}</p>
          {onProcessingCancel ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onProcessingCancel}
              className="gap-1.5"
            >
              <X className="h-4 w-4 shrink-0" aria-hidden />
              Cancelar processamento
            </Button>
          ) : null}
        </div>
      ) : !recording ? (
        <Button
          type="button"
          size="lg"
          disabled={busy}
          onClick={() => void startRecording()}
          className={cn(
            "h-20 w-20 rounded-full p-0 shadow-lg transition-all hover:scale-105",
            "bg-primary hover:bg-primary/90 border-0",
            busy && "opacity-50 pointer-events-none",
          )}
          aria-label="Iniciar gravação"
        >
          <Mic className="h-10 w-10" strokeWidth={2.25} aria-hidden />
        </Button>
      ) : (
        <div className="flex flex-col items-center gap-4 w-full">
          <div className={cn("flex flex-col items-center", !paused && "animate-pulse")}>
            <Button
              type="button"
              size="lg"
              onClick={stopAndProcess}
              className="h-20 w-20 rounded-full bg-destructive p-0 shadow-2xl hover:bg-destructive/90 border-0"
              aria-label="Parar e processar gravação"
            >
              <Square className="h-10 w-10" strokeWidth={2} aria-hidden />
            </Button>
            <div className="mt-3 flex flex-col items-center gap-2">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "h-2.5 w-2.5 rounded-full",
                    paused ? "bg-success" : "bg-destructive animate-pulse",
                  )}
                  aria-hidden
                />
                <p
                  className={cn(
                    "text-sm font-medium",
                    paused ? "text-success" : "text-destructive dark:text-destructive",
                  )}
                >
                  {paused ? "Gravação em pausa" : "Gravando…"}
                </p>
              </div>
              <RecordingDurationMarker elapsedSeconds={elapsed} maxSeconds={maxSeconds} />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            {pauseSupported && paused ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={resumeRecording}
                  className="gap-1.5 border-0 bg-white text-black shadow-sm hover:bg-muted dark:bg-white dark:text-black dark:hover:bg-muted [&_svg]:text-black"
                >
                  <Play className="h-4 w-4 shrink-0" aria-hidden />
                  Continuar gravação
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void discardRecording()}
                  className="gap-1.5 border-0 bg-white text-black shadow-sm hover:bg-muted dark:bg-white dark:text-black dark:hover:bg-muted"
                >
                  Descartar o que foi gravado
                </Button>
              </>
            ) : pauseSupported ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={pauseRecording}
                  className="gap-1.5 border-0 bg-white text-black shadow-sm hover:bg-muted dark:bg-white dark:text-black dark:hover:bg-muted [&_svg]:text-black"
                >
                  <Pause className="h-4 w-4 shrink-0" aria-hidden />
                  Pausar gravação
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void discardRecording()}
                  className="gap-1.5 border-0 bg-white text-black shadow-sm hover:bg-muted dark:bg-white dark:text-black dark:hover:bg-muted"
                >
                  Interromper gravação
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void discardRecording()}
                className="gap-1.5 border-0 bg-white text-black shadow-sm hover:bg-muted dark:bg-white dark:text-black dark:hover:bg-muted"
              >
                Interromper gravação
              </Button>
            )}
          </div>
        </div>
      )}
    </div>

    <PlanLimitUpgradeModal
      open={audioLimitModalOpen}
      onClose={() => setAudioLimitModalOpen(false)}
      kind="audio"
      currentPlan={currentPlan}
      audioSeconds={maxSeconds}
    />
    </>
  );
}
