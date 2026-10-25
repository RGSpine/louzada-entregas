"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getLastEvolutionCopyDraft } from "@/app/actions/patient";
import type { EvolutionCopyDraft } from "@/lib/evolution-copy-draft";
import {
  describeEvolutionCopyDraft,
  ensureEvolutionCopyDraftArtifacts,
} from "@/lib/evolution-copy-draft";
import { cn } from "@/lib/utils";

type Props = {
  patientId: string | null;
  /** Quando true (ex.: ?copyLast=1), aplica o rascunho assim que carregar. */
  autoApply?: boolean;
  hasExistingText: boolean;
  /** Aplica texto + campos do formulário + exames + artefactos na página de edição. */
  onApply: (draft: EvolutionCopyDraft) => void;
  /** Chamado quando o fetch termina (com ou sem draft) — para tirar o loading do copyLast. */
  onSettled?: () => void;
  className?: string;
};

export function CopyLastEvolutionPanel({
  patientId,
  autoApply = false,
  hasExistingText,
  onApply,
  onSettled,
  className,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<EvolutionCopyDraft | null>(null);
  const [applied, setApplied] = useState(false);
  const [autoApplied, setAutoApplied] = useState(false);
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  const loadDraft = useCallback(async () => {
    if (!patientId) {
      setDraft(null);
      onSettledRef.current?.();
      return;
    }
    setLoading(true);
    try {
      const res = await getLastEvolutionCopyDraft(patientId);
      if (!res.success) {
        toast.error(res.error);
        setDraft(null);
        onSettledRef.current?.();
        return;
      }
      setDraft(res.data);
      if (!res.data) onSettledRef.current?.();
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    setApplied(false);
    setAutoApplied(false);
    void loadDraft();
  }, [loadDraft]);

  const applyDraft = useCallback(
    (next: EvolutionCopyDraft, silent = false) => {
      if (hasExistingText && !silent) {
        const ok = window.confirm(
          "Substituir o texto atual e as orientações / pontos de ação pela última evolução? Você poderá gravar áudio em seguida para a IA mesclar as alterações.",
        );
        if (!ok) return;
      }
      onApply(next);
      setApplied(true);
      onSettledRef.current?.();
      if (!silent) {
        toast.success(
          `Última evolução carregada como base (${describeEvolutionCopyDraft(next)}).`,
        );
      }
    },
    [hasExistingText, onApply],
  );

  useEffect(() => {
    if (!autoApply || autoApplied || !draft || applied) return;
    applyDraft(draft, true);
    setAutoApplied(true);
    toast.success(
      `Última evolução carregada como base (${describeEvolutionCopyDraft(draft)}).`,
    );
  }, [autoApply, autoApplied, draft, applied, applyDraft]);

  if (!patientId || loading) {
    if (!patientId) return null;
    return (
      <div
        className={cn(
          "mb-6 flex items-center gap-2 rounded-xl border border-border bg-muted px-4 py-3 text-sm text-muted-foreground dark:border-border dark:bg-card/50 dark:text-muted-foreground",
          className,
        )}
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        A carregar evolução anterior…
      </div>
    );
  }

  if (!draft) return null;

  const artifactHint = (() => {
    const { professionalActions, patientHandout, medicationsAndSupplements } =
      ensureEvolutionCopyDraftArtifacts(draft);
    const hasForm = Boolean(draft.queixa || draft.conduta || draft.diagnostico);
    const hasExams = Boolean(draft.examsAnalysis?.trim());
    return professionalActions.items.length > 0 ||
      patientHandout.bullets.length > 0 ||
      Boolean(patientHandout.summary?.trim()) ||
      medicationsAndSupplements.items.length > 0 ||
      Boolean(medicationsAndSupplements.summary?.trim()) ||
      hasForm ||
      hasExams
      ? " Inclui formulário, exames, orientações, pontos de ação e/ou medicamentos da última evolução."
      : "";
  })();

  return (
    <div
      className={cn(
        "mb-6 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 dark:border-primary/40 dark:bg-primary/15",
        className,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-primary">
            Última evolução — {draft.dateLabel}
          </p>
          <p className="mt-1 line-clamp-3 text-sm text-primary/85">
            {draft.preview}
          </p>
          <p className="mt-2 text-xs text-primary/70">
            Use como base e grave áudio ou edite manualmente; a IA pode mesclar o que mudou
            hoje.{artifactHint}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 border-primary/30 bg-card/90 text-primary hover:bg-card dark:border-primary/40"
          disabled={applied && autoApply}
          onClick={() => applyDraft(draft)}
        >
          <Copy className="mr-2 h-4 w-4" aria-hidden />
          {applied ? "Base carregada" : "Usar como base"}
        </Button>
      </div>
    </div>
  );
}
