"use client";

import { useRef } from "react";
import {
  Mic,
  Square,
  Upload,
  Wand2,
  Loader2,
  FileText,
  X,
  Pause,
  Play,
  ClipboardList,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RecordingDurationMarker } from "@/components/dashboard/RecordingDurationMarker";

export interface EvolutionEnrichmentToolsProps {
  subtitle?: string;
  isAddingAudio: boolean;
  startAdditionalRecording: () => void;
  stopAdditionalRecording: () => void;
  /** Descarta o áudio em gravação e volta ao estado inicial (sem enviar à API). */
  discardAdditionalRecording: () => void;
  additionalRecordingPaused: boolean;
  pauseAdditionalRecording: () => void;
  resumeAdditionalRecording: () => void;
  isProcessingAdditional: boolean;
  isRevisingWithAI: boolean;
  additionalExamFiles: File[];
  handleAdditionalExamUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleRemoveAdditionalExam: (index: number) => void;
  processAdditionalExams: () => void;
  reviseWithAI: () => void;
  /** Só na página «Gerar documento»: preenche o rascunho com resumo das evoluções do paciente. */
  onExtractClinicalSummaryFromEvolutions?: () => void;
  isExtractingClinicalSummary?: boolean;
  extractClinicalSummaryDisabled?: boolean;
  additionalRawTranscription: string;
  /** Incrementar após cada seleção válida — remonta o input (mobile/iOS refire onChange). */
  fileInputResetKey?: number;
  /** Índices alinhados a `additionalExamFiles`: chaves estáveis para lista (evita glitches em mobile). */
  additionalExamStableKeys?: string[];
  /** Nomes mostrados na lista (fallback quando `file.name` vem vazio no mobile). */
  additionalExamDisplayNames?: string[];
  /** Bloquear anexos (ex.: plano BASICO na página «Gerar documento»). */
  attachDisabled?: boolean;
  attachDisabledHint?: string;
  /** Segundos decorridos na gravação adicional (para marcador MM:SS / limite). */
  recordingElapsedSeconds?: number;
  /** Limite em segundos conforme o plano (ex.: 600 para 10 min). */
  recordingMaxSeconds?: number;
  /** Controla visibilidade do botão "Acrescentar com áudio". */
  showAudioButton?: boolean;
}

export function EvolutionEnrichmentTools({
  subtitle = "Ferramentas opcionais para enriquecer sua evolução",
  isAddingAudio,
  startAdditionalRecording,
  stopAdditionalRecording,
  discardAdditionalRecording,
  additionalRecordingPaused,
  pauseAdditionalRecording,
  resumeAdditionalRecording,
  isProcessingAdditional,
  isRevisingWithAI,
  additionalExamFiles,
  handleAdditionalExamUpload,
  handleRemoveAdditionalExam,
  processAdditionalExams,
  reviseWithAI,
  onExtractClinicalSummaryFromEvolutions,
  isExtractingClinicalSummary = false,
  extractClinicalSummaryDisabled = false,
  additionalRawTranscription,
  fileInputResetKey = 0,
  additionalExamStableKeys,
  additionalExamDisplayNames,
  attachDisabled = false,
  attachDisabledHint,
  recordingElapsedSeconds,
  recordingMaxSeconds,
  showAudioButton = true,
}: EvolutionEnrichmentToolsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filePickerDisabled =
    attachDisabled ||
    additionalExamFiles.length >= 3 ||
    isProcessingAdditional ||
    isRevisingWithAI ||
    isExtractingClinicalSummary;

  const attachAccept =
    "application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp";

  const actionButtonBaseClass =
    "h-12 min-w-[12.75rem] justify-center px-4 text-sm font-semibold [&_svg]:text-white touch-manipulation";

  return (
    <Card className="bg-card/50 border-border mb-6">
      <CardContent className="pt-6">
        <div className="space-y-4">
          <p className="text-center text-primary dark:text-white text-2xl font-bold leading-snug">
            {subtitle}
          </p>
          {attachDisabled && attachDisabledHint ? (
            <p className="text-success text-xs text-center px-2">
              {attachDisabledHint}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-3 justify-center">
            {!isAddingAudio && showAudioButton ? (
              <Button
                onClick={startAdditionalRecording}
                disabled={
                  isProcessingAdditional ||
                  isRevisingWithAI ||
                  isExtractingClinicalSummary
                }
                className={`${actionButtonBaseClass} bg-primary hover:bg-primary/90`}
                size="sm"
              >
                <Mic className="h-4 w-4" />
                Acrescentar com áudio
              </Button>
            ) : isAddingAudio ? (
              <>
                <Button
                  onClick={stopAdditionalRecording}
                  className={`bg-destructive hover:bg-destructive/90 gap-2 ${additionalRecordingPaused ? "" : "animate-pulse"}`}
                  size="sm"
                >
                  <Square className="h-4 w-4" />
                  Parar gravação
                </Button>
                {!additionalRecordingPaused ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={pauseAdditionalRecording}
                    disabled={isProcessingAdditional}
                    className="gap-2 border-0 bg-white text-black shadow-sm hover:bg-muted hover:text-black focus-visible:ring-2 focus-visible:ring-ring dark:bg-white dark:text-black dark:hover:bg-muted dark:hover:text-black disabled:opacity-50 [&_svg]:text-black"
                  >
                    <Pause className="h-4 w-4 shrink-0 text-black" />
                    Pausar gravação
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={resumeAdditionalRecording}
                    className="gap-2 border-0 bg-white text-black shadow-sm hover:bg-muted hover:text-black focus-visible:ring-2 focus-visible:ring-ring dark:bg-white dark:text-black dark:hover:bg-muted dark:hover:text-black [&_svg]:text-black"
                  >
                    <Play className="h-4 w-4 shrink-0 text-black" />
                    Continuar gravação
                  </Button>
                )}
              </>
            ) : null}

            <input
              key={`doc-attach-${fileInputResetKey}`}
              ref={fileInputRef}
              type="file"
              accept={attachAccept}
              multiple
              disabled={filePickerDisabled}
              onChange={handleAdditionalExamUpload}
              className="hidden"
              aria-hidden
              tabIndex={-1}
            />
            <Button
              type="button"
              disabled={filePickerDisabled}
              size="sm"
              className={`${actionButtonBaseClass} bg-success hover:bg-success/90 focus-visible:ring-success/35`}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4" />
              Anexar arquivos
              {additionalExamFiles.length > 0 && (
                <span className="rounded bg-success px-1.5 py-0.5 text-xs">
                  {additionalExamFiles.length}
                </span>
              )}
            </Button>

            <Button
              onClick={reviseWithAI}
              disabled={
                isRevisingWithAI ||
                isProcessingAdditional ||
                isAddingAudio ||
                isExtractingClinicalSummary
              }
              className={`${actionButtonBaseClass} bg-clinical hover:bg-clinical/90`}
              size="sm"
            >
              {isRevisingWithAI ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Revisando...
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4" />
                  Revisar com IA
                </>
              )}
            </Button>

            {onExtractClinicalSummaryFromEvolutions ? (
              <Button
                type="button"
                onClick={onExtractClinicalSummaryFromEvolutions}
                disabled={
                  extractClinicalSummaryDisabled ||
                  isExtractingClinicalSummary ||
                  isProcessingAdditional ||
                  isAddingAudio ||
                  isRevisingWithAI
                }
                className="bg-clinical hover:bg-clinical/90 gap-2"
                size="sm"
              >
                {isExtractingClinicalSummary ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    A extrair…
                  </>
                ) : (
                  <>
                    <ClipboardList className="h-4 w-4" />
                    Extrair resumo clínico das evoluções
                  </>
                )}
              </Button>
            ) : null}
          </div>

          {isAddingAudio && (
            <div className="mt-4">
              <div className="flex items-center gap-2 justify-center mb-2">
                <div
                  className={`h-2 w-2 rounded-full ${additionalRecordingPaused ? "bg-success" : "bg-destructive animate-pulse"}`}
                />
                <p
                  className={`text-sm ${additionalRecordingPaused ? "text-success" : "text-destructive"}`}
                >
                  {additionalRecordingPaused
                    ? "Áudio adicional em pausa"
                    : "Gravando áudio adicional..."}
                </p>
              </div>
              {recordingElapsedSeconds !== undefined &&
              recordingMaxSeconds !== undefined ? (
                <div className="flex justify-center mb-2">
                  <RecordingDurationMarker
                    elapsedSeconds={recordingElapsedSeconds}
                    maxSeconds={recordingMaxSeconds}
                  />
                </div>
              ) : null}
              {additionalRawTranscription && (
                <div className="bg-background border border-border rounded-lg p-3 max-h-32 overflow-y-auto">
                  <p className="text-foreground/90 text-sm">
                    {additionalRawTranscription}
                  </p>
                </div>
              )}
              <div className="flex justify-center mt-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={discardAdditionalRecording}
                  className="border-0 bg-white px-4 text-black shadow-sm hover:bg-muted hover:text-black focus-visible:ring-2 focus-visible:ring-ring dark:bg-white dark:text-black dark:hover:bg-muted dark:hover:text-black"
                >
                  {additionalRecordingPaused
                    ? "Descartar o que foi gravado"
                    : "Interromper gravação"}
                </Button>
              </div>
            </div>
          )}

          {isProcessingAdditional && (
            <div className="flex items-center gap-2 justify-center mt-4">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <p className="text-muted-foreground dark:text-muted-foreground text-sm">
                Processando informações...
              </p>
            </div>
          )}

          {additionalExamFiles.length > 0 && (
            <div className="space-y-2 mt-4">
              <p className="text-muted-foreground text-xs text-center">
                Arquivos para processar:
              </p>
              <p className="text-muted-foreground text-[11px] text-center px-1">
                Toque em «Processar» para a IA ler os ficheiros e acrescentar ao texto-base de forma complementar.
              </p>
              {additionalExamFiles.map((file, index) => (
                <div
                  key={
                    additionalExamStableKeys?.[index] ??
                    `${file.name}-${file.size}-${file.lastModified}-${index}`
                  }
                  className="flex justify-between items-center bg-muted dark:bg-muted p-2 rounded border border-border gap-2"
                >
                  <p className="text-sm text-foreground/90 truncate flex-1 min-w-0">
                    {additionalExamDisplayNames?.[index]?.trim() ||
                      file.name?.trim() ||
                      `Anexo ${index + 1}`}
                  </p>
                  <button
                    onClick={() => handleRemoveAdditionalExam(index)}
                    className="text-destructive hover:text-destructive transition-colors shrink-0"
                    type="button"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
              <Button
                onClick={processAdditionalExams}
                disabled={isProcessingAdditional}
                className="mt-2 w-full gap-2 bg-success hover:bg-success/90"
                size="sm"
              >
                {isProcessingAdditional ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Processando...
                  </>
                ) : (
                  <>
                    <FileText className="h-4 w-4" />
                    Processar {additionalExamFiles.length} arquivo(s)
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
