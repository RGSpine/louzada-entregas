"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Info, Loader2, Mic, Send, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RecordingDurationMarker } from "@/components/dashboard/RecordingDurationMarker";
import { getSupportedRecorderMimeOptions } from "@/lib/audio-recording-mime";
import {
  releaseMediaStream,
  startMediaRecorder,
} from "@/lib/media-recorder-safe";
import { cn } from "@/lib/utils";
import type {
  ClinicalChatEvidenceQuotaItem,
  ClinicalChatSessionMeta,
} from "@/app/actions/clinical-chat";

type PatientChatInputProps = {
  disabled?: boolean;
  sending?: boolean;
  maxAudioSeconds: number;
  evidenceQuota?: ClinicalChatEvidenceQuotaItem | null;
  sessionMeta?: ClinicalChatSessionMeta | null;
  onSend: (payload: { text: string; audioBlob?: Blob; audioDurationSec?: number }) => void;
};

function ChatDisclaimerHint({ sessionMeta }: { sessionMeta: ClinicalChatSessionMeta | null }) {
  const [open, setOpen] = useState(false);
  const [canHover, setCanHover] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();

  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const sync = () => setCanHover(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  useEffect(() => {
    if (!open || canHover) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        hide();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [canHover, hide, open]);

  return (
    <div className="relative mt-2 flex justify-center">
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 rounded-full px-2.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        aria-label="Sobre o uso da Ester"
        onMouseEnter={canHover ? show : undefined}
        onMouseLeave={canHover ? hide : undefined}
        onFocus={canHover ? show : undefined}
        onBlur={canHover ? hide : undefined}
        onClick={canHover ? undefined : toggle}
      >
        <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>Sobre a Ester</span>
      </Button>

      {open ? (
        <div
          ref={panelRef}
          id={tooltipId}
          role="tooltip"
          className="absolute bottom-full left-1/2 z-30 mb-2 w-[min(calc(100vw-2rem),22rem)] -translate-x-1/2 rounded-xl border border-border bg-card px-3.5 py-3 text-left shadow-[var(--shadow-elevation-3)]"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute -bottom-[6px] left-1/2 size-3 -translate-x-1/2 rotate-45 border-b border-r border-border bg-card"
          />
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            A Ester usa evoluções, exames, métricas e medicamentos registrados — não substitui seu
            julgamento profissional.
          </p>
          {sessionMeta ? (
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              A IA usa as últimas {sessionMeta.aiContextMessageLimit} mensagens na conversa; o
              histórico completo fica salvo para consulta (até {sessionMeta.storedMessageLimit}{" "}
              mensagens ou {sessionMeta.retentionMonths} meses).
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function PatientChatInput({
  disabled = false,
  sending = false,
  maxAudioSeconds,
  evidenceQuota = null,
  sessionMeta = null,
  onSend,
}: PatientChatInputProps) {
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioDurationSec, setAudioDurationSec] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartRef = useRef<number>(0);
  const mimeRef = useRef<string>("audio/webm");

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
  };

  const handleRecorderStop = () => {
    clearTimer();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    releaseMediaStream(streamRef.current);
    streamRef.current = null;
    setRecording(false);

    const mime =
      recorder?.mimeType.split(";")[0]?.trim().toLowerCase() || mimeRef.current || "audio/webm";
    const blob = new Blob(chunksRef.current, { type: mime });
    const duration = Math.max(1, Math.round((Date.now() - recordingStartRef.current) / 1000));
    chunksRef.current = [];

    if (blob.size > 0) {
      setAudioBlob(blob);
      setAudioDurationSec(duration);
      setElapsed(duration);
    }
  };

  const discardAudio = () => {
    setAudioBlob(null);
    setAudioDurationSec(0);
    setElapsed(0);
  };

  const startRecording = async () => {
    if (disabled || sending) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const opts = getSupportedRecorderMimeOptions();
      const recorder = opts ? new MediaRecorder(stream, opts) : new MediaRecorder(stream);
      mimeRef.current =
        opts?.mimeType.split(";")[0]?.trim().toLowerCase() || "audio/webm";
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = handleRecorderStop;
      recorderRef.current = recorder;
      recordingStartRef.current = Date.now();
      startMediaRecorder(recorder);
      setRecording(true);
      setElapsed(0);
      clearTimer();
      timerRef.current = setInterval(() => {
        setElapsed((prev) => {
          const next = prev + 1;
          if (next >= maxAudioSeconds) {
            stopRecording();
          }
          return next;
        });
      }, 1000);
    } catch {
      toast.error("Não foi possível acessar o microfone.");
    }
  };

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed && !audioBlob) {
      toast.error("Digite uma pergunta ou grave um áudio.");
      return;
    }
    onSend({
      text: trimmed,
      audioBlob: audioBlob ?? undefined,
      audioDurationSec: audioBlob ? audioDurationSec : undefined,
    });
    setText("");
    discardAudio();
  };

  const busy = disabled || sending;
  const canSend = !busy && (text.trim().length > 0 || !!audioBlob);

  return (
    <div className="shrink-0 border-t border-border/90 bg-white/90 px-3 py-3 backdrop-blur-md dark:border-border dark:bg-background/90 sm:px-4 sm:py-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-3xl">
        {audioBlob && !recording ? (
          <div className="mb-2.5 flex items-center justify-between rounded-xl border border-clinical/30 bg-clinical/10 px-3 py-2 text-sm dark:border-clinical/40 dark:bg-clinical/15">
            <span className="font-medium text-clinical dark:text-clinical">
              Áudio gravado ({audioDurationSec}s)
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={discardAudio}
              disabled={busy}
              aria-label="Descartar áudio"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ) : null}

        {recording ? (
          <div className="mb-2.5 flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 dark:border-destructive/40 dark:bg-destructive/15">
            <RecordingDurationMarker elapsedSeconds={elapsed} maxSeconds={maxAudioSeconds} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={stopRecording}
              className="ml-auto"
            >
              <Square className="mr-1 h-3 w-3 fill-current" />
              Parar
            </Button>
          </div>
        ) : null}

        <div
          className={cn(
            "flex items-end gap-2 rounded-2xl border border-border/90 bg-card p-2 shadow-[var(--shadow-elevation-2)] ring-1 ring-border/50 dark:border-border dark:bg-card dark:ring-border",
            "focus-within:border-clinical/40 focus-within:ring-2 focus-within:ring-clinical/20 dark:focus-within:border-clinical",
          )}
        >
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Pergunte sobre o caso, exames ou medicamentos deste paciente…"
            rows={1}
            disabled={busy || recording}
            className="min-h-[44px] max-h-32 flex-1 resize-none border-0 bg-transparent text-[0.9375rem] shadow-none placeholder:text-muted-foreground focus-visible:ring-0 dark:placeholder:text-muted-foreground"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canSend) handleSubmit();
              }
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => (recording ? stopRecording() : void startRecording())}
            disabled={busy}
            aria-label={recording ? "Parar gravação" : "Gravar áudio"}
            className={cn(
              "shrink-0 rounded-xl",
              recording && "bg-destructive/10 text-destructive hover:bg-destructive/15 ",
            )}
          >
            <Mic className="h-5 w-5" />
          </Button>
          <Button
            type="button"
            size="icon"
            onClick={handleSubmit}
            disabled={!canSend}
            aria-label="Enviar mensagem"
            className="shrink-0 rounded-xl bg-gradient-to-br from-clinical to-accent shadow-md shadow-clinical/25 hover:from-clinical/90 hover:to-accent/90 disabled:opacity-40"
          >
            {sending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </Button>
        </div>
        <ChatDisclaimerHint sessionMeta={sessionMeta} />
        {evidenceQuota && !evidenceQuota.unlimited && evidenceQuota.limitThisMonth != null ? (
          <p
            className={cn(
              "mt-1 text-center text-[11px]",
              evidenceQuota.remaining === 0
                ? "font-medium text-warning"
                : evidenceQuota.remaining != null && evidenceQuota.remaining <= 5
                  ? "text-warning dark:text-warning"
                  : "text-muted-foreground dark:text-muted-foreground",
            )}
          >
            Buscas de evidência este mês (UTC): {evidenceQuota.usedThisMonth}/
            {evidenceQuota.limitThisMonth}
            {evidenceQuota.remaining === 0
              ? " — limite atingido; respostas usam só o prontuário."
              : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}
