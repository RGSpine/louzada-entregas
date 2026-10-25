"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Loader2, Mic, Square, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RecordingDurationMarker } from "@/components/dashboard/RecordingDurationMarker";
import { getSupportedRecorderMimeOptions, fileExtensionForAudioBlob } from "@/lib/audio-recording-mime";
import type { OfficeFinanceExtractionEnvelope } from "@/lib/office-finance-ai-extract";
import { pollOfficeFinanceExtractionUntilDone } from "@/lib/office-finance-async-client";
import type { OfficeFinanceExtractTarget } from "@/lib/office-finance-extract-target";
import { cn } from "@/lib/utils";
import {
  financeOutlineBtnClass,
  financeOutlineLabelBtnClass,
} from "@/components/dashboard/finances/finance-outline-btn";

const MAX_ATTACHMENTS = 5;

type ExtractPayload = Partial<{
  success: boolean;
  error?: string;
  envelope?: OfficeFinanceExtractionEnvelope;
}>;

type Props = {
  target: OfficeFinanceExtractTarget;
  allowImageUpload: boolean;
  maxAudioMinutes: number;
  disabled?: boolean;
  /** Texto curto acima dos botões */
  hint?: string;
  allowText?: boolean;
  onEnvelope: (envelope: OfficeFinanceExtractionEnvelope) => void;
  outlineBtnClass?: string;
};

export function FinanceFormIntakeToolbar({
  target,
  allowImageUpload,
  maxAudioMinutes,
  disabled,
  hint,
  allowText = false,
  onEnvelope,
  outlineBtnClass = financeOutlineBtnClass,
}: Props) {
  const [recording, setRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [cameraInputKey, setCameraInputKey] = useState(0);
  const [extracting, setExtracting] = useState(false);
  const [inputText, setInputText] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef(0);
  const discardRef = useRef(false);
  const secAtStopRef = useRef(0);

  const capSeconds = useMemo(() => {
    if (!Number.isFinite(maxAudioMinutes)) return 7200;
    return Math.max(30, Math.floor(maxAudioMinutes * 60));
  }, [maxAudioMinutes]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (!recording || !recorderRef.current) return;
    if (elapsedSec + 2 < capSeconds) return;
    try {
      recorderRef.current.stop();
    } catch {
      /* ignore */
    }
  }, [recording, elapsedSec, capSeconds]);

  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function startRecording() {
    if (recording || extracting || disabled) return;
    try {
      discardRef.current = false;
      setRecordedBlob(null);
      clearTimer();
      tickRef.current = 0;
      setElapsedSec(0);
      chunksRef.current = [];
      secAtStopRef.current = 0;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const opts = getSupportedRecorderMimeOptions();
      const recorder = opts ? new MediaRecorder(stream, opts) : new MediaRecorder(stream);
      recorder.ondataavailable = (evt) => {
        if (evt.data.size > 0) chunksRef.current.push(evt.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        clearTimer();
        recorderRef.current = null;
        streamRef.current = null;
        setRecording(false);
        if (discardRef.current) {
          discardRef.current = false;
          tickRef.current = 0;
          setElapsedSec(0);
          return;
        }
        secAtStopRef.current = tickRef.current;
        const mime =
          recorder.mimeType.split(";")[0]?.trim().toLowerCase() ||
          opts?.mimeType.split(";")[0]?.trim().toLowerCase() ||
          "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mime || "audio/webm" });
        if (blob.size > 0) setRecordedBlob(blob);
        tickRef.current = 0;
        setElapsedSec(0);
      };

      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      timerRef.current = setInterval(() => {
        tickRef.current += 1;
        const next = tickRef.current;
        setElapsedSec(next);
        if (recorderRef.current && next >= capSeconds) {
          try {
            recorderRef.current.stop();
          } catch {
            /* ignore */
          }
        }
      }, 1000);
    } catch {
      toast.error("Não foi possível aceder ao microfone.");
      setRecording(false);
    }
  }

  function discardRecording() {
    if (!recording && !recordedBlob) return;
    if (recording) {
      discardRef.current = true;
      try {
        recorderRef.current?.stop();
      } catch {
        clearTimer();
        streamRef.current?.getTracks().forEach((t) => t.stop());
        recorderRef.current = null;
        streamRef.current = null;
        setRecording(false);
      }
    } else {
      setRecordedBlob(null);
    }
  }

  function onFilesPick(files: File[]) {
    if (!files.length) return;
    if (!allowImageUpload) {
      toast.error("Seu plano só permite áudio. Faça upgrade (Profissional+) para anexar ficheiros.");
      return;
    }
    setImageFiles((prev) => [...prev, ...files].slice(0, MAX_ATTACHMENTS));
  }

  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    onFilesPick(Array.from(e.target.files ?? []).filter((f) => f.size > 0));
    setFileInputKey((k) => k + 1);
    e.target.value = "";
  }

  function onCameraInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    onFilesPick(Array.from(e.target.files ?? []).filter((f) => f.size > 0));
    setCameraInputKey((k) => k + 1);
    e.target.value = "";
  }

  async function submitExtract() {
    const hasBlob = !!(recordedBlob && recordedBlob.size > 0);
    const hasFiles = imageFiles.length > 0;
    const hasText = allowText && inputText.trim().length > 0;
    if (!hasBlob && !hasFiles && !hasText) {
      toast.error("Informe texto, grave áudio ou anexe imagem/PDF.");
      return;
    }
    if (recording) {
      toast.error("Pare a gravação antes de enviar.");
      return;
    }
    if (hasFiles && !allowImageUpload) {
      toast.error("Plano gratuito: use só áudio.");
      return;
    }

    setExtracting(true);
    try {
      const fd = new FormData();
      fd.append("extractTarget", target);
      if (hasText) fd.append("text", inputText.trim());
      if (hasBlob && recordedBlob) {
        const baseMime = recordedBlob.type.split(";")[0]?.trim().toLowerCase() || "audio/webm";
        const ext = fileExtensionForAudioBlob(baseMime);
        fd.append("audio", new File([recordedBlob], `finance-intake.${ext}`, { type: baseMime }));
        fd.append("audioDurationSec", String(Math.min(secAtStopRef.current || 0, capSeconds)));
      }
      imageFiles.forEach((file) => fd.append("imageFiles", file));

      const res = await fetch("/api/office-finance/extract", { method: "POST", body: fd });
      let data: ExtractPayload | null = null;

      if (res.status === 202) {
        toast.info("Processando em segundo plano…", { duration: 6000 });
        const queued = (await res.json().catch(() => null)) as Partial<{ jobId?: string }> | null;
        if (!queued?.jobId) {
          toast.error("Resposta de fila inválida.");
          return;
        }
        data = (await pollOfficeFinanceExtractionUntilDone(queued.jobId)) as ExtractPayload;
      } else {
        data = (await res.json().catch(() => null)) as ExtractPayload;
        if (!res.ok) {
          toast.error(data?.error ?? "Pedido rejeitado.");
          return;
        }
      }

      if (!data?.success || !data.envelope) {
        toast.error(data?.error ?? "Não foi possível interpretar.");
        return;
      }

      onEnvelope(data.envelope);
      setImageFiles([]);
      setRecordedBlob(null);
      setInputText("");
      secAtStopRef.current = 0;
      setFileInputKey((k) => k + 1);
      setCameraInputKey((k) => k + 1);
    } finally {
      setExtracting(false);
    }
  }

  const acceptFiles =
    target === "catalog"
      ? "application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp"
      : "application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp";

  return (
    <div className="rounded-lg border border-clinical/30 bg-clinical/10 p-3 space-y-3 dark:border-clinical/25 dark:bg-clinical/15">
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {allowText && (
        <Textarea
          value={inputText}
          onChange={(event) => setInputText(event.target.value)}
          maxLength={4000}
          rows={2}
          disabled={disabled || extracting}
          placeholder="Ex.: O Marcelo pagou R$ 450 no PIX pela coroa entregue hoje."
          aria-label="Descrição do trabalho, da coleta ou da entrega"
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!recording ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn("h-8 text-xs", outlineBtnClass)}
            disabled={disabled || extracting}
            onClick={() => void startRecording()}
          >
            <Mic className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Áudio
          </Button>
        ) : (
          <>
            <RecordingDurationMarker elapsedSeconds={elapsedSec} maxSeconds={capSeconds} />
            <Button
              type="button"
              size="sm"
              className="h-8 bg-clinical hover:bg-clinical/90 text-xs"
              onClick={() => {
                discardRef.current = false;
                try {
                  recorderRef.current?.stop();
                } catch {
                  /* ignore */
                }
              }}
            >
              <Square className="mr-1 h-3 w-3" aria-hidden /> Parar
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-8 text-xs text-foreground/90 dark:text-foreground" onClick={discardRecording}>
              Descartar
            </Button>
          </>
        )}

        <label
          className={cn(
            financeOutlineLabelBtnClass,
            (!allowImageUpload || extracting) && "opacity-50 pointer-events-none",
          )}
        >
          <Upload className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Ficheiro/PDF
          <input
            key={fileInputKey}
            type="file"
            className="sr-only"
            accept={acceptFiles}
            multiple
            disabled={disabled || extracting || !allowImageUpload || imageFiles.length >= MAX_ATTACHMENTS}
            onChange={onFileInputChange}
          />
        </label>

        <label
          className={cn(
            financeOutlineLabelBtnClass,
            (!allowImageUpload || extracting) && "opacity-50 pointer-events-none",
          )}
        >
          <Camera className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Câmara
          <input
            key={cameraInputKey}
            type="file"
            className="sr-only"
            accept="image/*"
            capture="environment"
            disabled={disabled || extracting || !allowImageUpload || imageFiles.length >= MAX_ATTACHMENTS}
            onChange={onCameraInputChange}
          />
        </label>

        <Button
          type="button"
          size="sm"
          className="h-8 bg-clinical hover:bg-clinical/90 text-xs"
          disabled={disabled || extracting || recording}
          onClick={() => void submitExtract()}
        >
          {extracting ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
              Interpretando…
            </>
          ) : (
            "Preencher com IA"
          )}
        </Button>
      </div>

      {recordedBlob && recordedBlob.size > 0 && !recording && (
        <p className="text-[11px] text-clinical">
          Áudio pronto ({(recordedBlob.size / 1024).toFixed(0)} KB)
        </p>
      )}

      {imageFiles.length > 0 && (
        <ul className="space-y-1 text-[11px] text-foreground/90">
          {imageFiles.map((f, idx) => (
            <li
              key={`${f.name}-${idx}`}
              className="flex items-center justify-between gap-2 rounded bg-white/80 px-2 py-1 dark:bg-muted/70"
            >
              <span className="truncate">{f.name}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                aria-label={`Remover ${f.name}`}
                onClick={() => setImageFiles((prev) => prev.filter((_, i) => i !== idx))}
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
