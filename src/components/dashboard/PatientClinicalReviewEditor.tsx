"use client";

import { useState } from "react";
import { Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updatePatientClinicalReview } from "@/app/actions/patient";

const SUMMARY_MAX = 1500;
const BULLET_MAX = 220;
const BULLETS_MAX = 15;

interface PatientClinicalReviewEditorProps {
  patientId: string;
  summary: string | null;
  bullets: string[] | null;
  onSaved: (next: { summary: string; caseHighlights: string[] }) => void;
  onCancel: () => void;
}

export function PatientClinicalReviewEditor({
  patientId,
  summary,
  bullets,
  onSaved,
  onCancel,
}: PatientClinicalReviewEditorProps) {
  const [draftSummary, setDraftSummary] = useState(summary ?? "");
  const [draftBullets, setDraftBullets] = useState<string[]>(
    bullets && bullets.length > 0 ? bullets : [],
  );
  const [isSaving, setIsSaving] = useState(false);

  const updateBullet = (index: number, value: string) => {
    setDraftBullets((prev) => prev.map((b, i) => (i === index ? value.slice(0, BULLET_MAX) : b)));
  };

  const removeBullet = (index: number) => {
    setDraftBullets((prev) => prev.filter((_, i) => i !== index));
  };

  const addBullet = () => {
    setDraftBullets((prev) => (prev.length >= BULLETS_MAX ? prev : [...prev, ""]));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const result = await updatePatientClinicalReview({
        patientId,
        summary: draftSummary.trim(),
        bullets: draftBullets.map((b) => b.trim()).filter(Boolean),
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Revisão salva", {
        description: "O que você removeu não volta quando a IA atualizar o resumo.",
      });
      onSaved({ summary: result.summary, caseHighlights: result.caseHighlights });
    } catch (error) {
      console.error("Erro ao salvar revisão clínica:", error);
      toast.error("Não foi possível salvar a revisão.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="clinical-grouped mb-8 border-clinical/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-foreground">
          <ShieldCheck className="h-5 w-5 text-clinical" />
          Revisar resumo e tópicos do caso
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Corrija ou apague o que a IA escreveu sem base no atendimento. Itens removidos ficam
          registrados e não são reintroduzidos nas próximas atualizações automáticas.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="clinical-review-summary">Resumo clínico</Label>
          <Textarea
            id="clinical-review-summary"
            value={draftSummary}
            onChange={(e) => setDraftSummary(e.target.value.slice(0, SUMMARY_MAX))}
            rows={5}
            className="text-base"
            disabled={isSaving}
          />
          <p className="text-right text-xs text-muted-foreground">
            {draftSummary.length}/{SUMMARY_MAX}
          </p>
        </div>

        <div className="space-y-2">
          <Label>Tópicos principais do caso</Label>
          {draftBullets.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum tópico. Adicione se quiser.</p>
          ) : (
            <ul className="space-y-2">
              {draftBullets.map((bullet, index) => (
                <li key={index} className="flex items-center gap-2">
                  <span className="w-6 shrink-0 text-right text-sm font-medium text-clinical" aria-hidden>
                    {index + 1}.
                  </span>
                  <Input
                    value={bullet}
                    onChange={(e) => updateBullet(index, e.target.value)}
                    aria-label={`Tópico ${index + 1}`}
                    className="min-h-[2.75rem] flex-1"
                    disabled={isSaving}
                  />
                  <button
                    type="button"
                    onClick={() => removeBullet(index)}
                    disabled={isSaving}
                    className="inline-flex min-h-[2.75rem] min-w-[2.75rem] items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                    aria-label={`Remover tópico ${index + 1}`}
                    title="Remover tópico"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addBullet}
            disabled={isSaving || draftBullets.length >= BULLETS_MAX}
            className="min-h-[2.75rem]"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Adicionar tópico
          </Button>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isSaving}
            className="min-h-[2.75rem]"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving}
            className="min-h-[2.75rem] bg-clinical text-clinical-foreground hover:bg-clinical/90"
          >
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Salvar revisão
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
