"use client";

import { useEffect, useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  getEvolutionClinicalTextForEdit,
  updateEvolutionClinicalText,
  type EditableEvolutionClinicalText,
} from "@/app/actions/patient";

interface EvolutionClinicalTextEditorProps {
  evolutionId: string;
  dateLabel: string;
  onClose: () => void;
  onSaved: () => void;
}

export function EvolutionClinicalTextEditor({
  evolutionId,
  dateLabel,
  onClose,
  onSaved,
}: EvolutionClinicalTextEditorProps) {
  const [draft, setDraft] = useState<EditableEvolutionClinicalText | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getEvolutionClinicalTextForEdit(evolutionId).then((result) => {
      if (cancelled) return;
      if (result.success) setDraft(result.data);
      else setLoadError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [evolutionId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSaving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isSaving, onClose]);

  const setField = (key: keyof Omit<EditableEvolutionClinicalText, "id">, value: string) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleSave = async () => {
    if (!draft) return;
    if (!draft.content.trim()) {
      toast.error("O texto da evolução não pode ficar vazio.");
      return;
    }
    setIsSaving(true);
    try {
      const result = await updateEvolutionClinicalText({
        evolutionId: draft.id,
        content: draft.content,
        queixa: draft.queixa,
        diagnostico: draft.diagnostico,
        conduta: draft.conduta,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      onSaved();
    } catch (error) {
      console.error("Erro ao salvar evolução:", error);
      toast.error("Não foi possível salvar a correção.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="evolution-edit-title"
    >
      <Card className="flex max-h-[90vh] w-full max-w-3xl flex-col border-border bg-card">
        <CardHeader className="shrink-0">
          <CardTitle id="evolution-edit-title" className="flex items-center gap-2 text-foreground">
            <Pencil className="h-5 w-5 text-primary" />
            Corrigir evolução de {dateLabel}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Ajuste termos ou trechos que não correspondem ao atendimento. O PDF será gerado de novo
            com o texto corrigido no próximo download.
          </p>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          {loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : !draft ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="evo-edit-queixa">Queixa principal</Label>
                  <Input
                    id="evo-edit-queixa"
                    value={draft.queixa}
                    onChange={(e) => setField("queixa", e.target.value)}
                    disabled={isSaving}
                    className="min-h-[2.75rem]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="evo-edit-diagnostico">Diagnóstico</Label>
                  <Input
                    id="evo-edit-diagnostico"
                    value={draft.diagnostico}
                    onChange={(e) => setField("diagnostico", e.target.value)}
                    disabled={isSaving}
                    className="min-h-[2.75rem]"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="evo-edit-conduta">Conduta</Label>
                <Input
                  id="evo-edit-conduta"
                  value={draft.conduta}
                  onChange={(e) => setField("conduta", e.target.value)}
                  disabled={isSaving}
                  className="min-h-[2.75rem]"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="evo-edit-content">Evolução</Label>
                <Textarea
                  id="evo-edit-content"
                  value={draft.content}
                  onChange={(e) => setField("content", e.target.value)}
                  rows={14}
                  disabled={isSaving}
                  className="text-base leading-relaxed"
                />
              </div>
            </>
          )}
        </CardContent>
        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border p-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSaving}
            className="min-h-[2.75rem]"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving || !draft}
            className="min-h-[2.75rem]"
          >
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Salvar correção
          </Button>
        </div>
      </Card>
    </div>
  );
}
