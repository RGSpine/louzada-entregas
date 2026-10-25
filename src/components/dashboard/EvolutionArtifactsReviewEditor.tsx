"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  MedicationSupplementItem,
  MedicationsAndSupplementsStored,
  PatientHandoutStored,
  ProfessionalActionItem,
  ProfessionalActionsStored,
} from "@/lib/evolution-artifacts";
import { EVOLUTION_ARTIFACTS_VERSION } from "@/lib/evolution-artifacts";
import { ListChecks, Pill, Plus, Trash2, UserCircle } from "lucide-react";

const ACTION_TYPES = [
  { value: "", label: "Tipo (opcional)" },
  { value: "schedule_exam", label: "Agendar exame" },
  { value: "message", label: "Mensagem / contato" },
  { value: "spreadsheet", label: "Planilha / registro" },
  { value: "referral", label: "Encaminhamento" },
  { value: "nutrition_plan", label: "Plano alimentar" },
  { value: "custom", label: "Outro" },
] as const;

const PRIORITIES = [
  { value: "", label: "Prioridade" },
  { value: "low", label: "Sem pressa" },
  { value: "medium", label: "Rápida" },
  { value: "high", label: "Urgente" },
] as const;

function normalizeProfessionalActions(stored: ProfessionalActionsStored): ProfessionalActionsStored {
  const items = stored.items ?? [];
  return {
    v: EVOLUTION_ARTIFACTS_VERSION,
    items: items.slice(0, 20).map((i) => ({
      label: i.label.slice(0, 500),
      type: i.type?.slice(0, 80) || undefined,
      rationale: i.rationale?.slice(0, 2000) || undefined,
      priority:
        i.priority === "low" || i.priority === "medium" || i.priority === "high"
          ? i.priority
          : undefined,
      dueHint: i.dueHint?.slice(0, 200) || undefined,
      completed: typeof i.completed === "boolean" ? i.completed : undefined,
    })),
  };
}

function normalizePatientHandout(stored: PatientHandoutStored): PatientHandoutStored {
  const bullets = (stored.bullets ?? [])
    .map((b) => b.trim())
    .filter(Boolean)
    .slice(0, 30)
    .map((b) => b.slice(0, 2000));
  const summary = stored.summary?.trim().slice(0, 4000);
  return {
    v: EVOLUTION_ARTIFACTS_VERSION,
    bullets,
    summary: summary && summary.length > 0 ? summary : undefined,
  };
}

function normalizeMedicationsAndSupplements(
  stored: MedicationsAndSupplementsStored,
): MedicationsAndSupplementsStored {
  const items = (stored.items ?? []).slice(0, 30).map((i) => ({
    name: i.name.slice(0, 300),
    kind:
      i.kind === "medication" || i.kind === "supplement" || i.kind === "other"
        ? i.kind
        : undefined,
    dose: i.dose?.slice(0, 200) || undefined,
    frequency: i.frequency?.slice(0, 200) || undefined,
    route: i.route?.slice(0, 120) || undefined,
    effects: i.effects?.slice(0, 2000) || undefined,
    interactions: i.interactions?.slice(0, 2000) || undefined,
    notes: i.notes?.slice(0, 2000) || undefined,
  }));
  const summary = stored.summary?.trim().slice(0, 4000);
  return {
    v: EVOLUTION_ARTIFACTS_VERSION,
    items,
    summary: summary && summary.length > 0 ? summary : undefined,
  };
}

/** Converte rascunho da UI em objetos persistíveis (JSON Evolution), sem alterar o texto da evolução. */
export function evolutionArtifactsForPersistence(
  prof: ProfessionalActionsStored,
  handout: PatientHandoutStored,
  meds: MedicationsAndSupplementsStored = { v: EVOLUTION_ARTIFACTS_VERSION, items: [] },
): {
  professionalActions: ProfessionalActionsStored | undefined;
  patientHandout: PatientHandoutStored | undefined;
  medicationsAndSupplements: MedicationsAndSupplementsStored | undefined;
} {
  const p = normalizeProfessionalActions(prof);
  const items = p.items.filter((i) => i.label.trim().length > 0);
  const h = normalizePatientHandout(handout);
  const hasHandout =
    (h.summary && h.summary.trim().length > 0) || h.bullets.length > 0;
  const m = normalizeMedicationsAndSupplements(meds);
  const medItems = m.items.filter((i) => i.name.trim().length > 0);
  const hasMeds =
    medItems.length > 0 || Boolean(m.summary && m.summary.trim().length > 0);

  return {
    professionalActions:
      items.length > 0 ? { v: EVOLUTION_ARTIFACTS_VERSION, items } : undefined,
    patientHandout: hasHandout ? h : undefined,
    medicationsAndSupplements: hasMeds
      ? { v: EVOLUTION_ARTIFACTS_VERSION, items: medItems, summary: m.summary }
      : undefined,
  };
}

const MED_KINDS = [
  { value: "", label: "Tipo (opcional)" },
  { value: "medication", label: "Medicamento" },
  { value: "supplement", label: "Suplemento" },
  { value: "other", label: "Outro" },
] as const;

interface EvolutionArtifactsReviewEditorProps {
  professionalActions: ProfessionalActionsStored;
  patientHandout: PatientHandoutStored;
  medicationsAndSupplements: MedicationsAndSupplementsStored;
  onProfessionalActionsChange: (next: ProfessionalActionsStored) => void;
  onPatientHandoutChange: (next: PatientHandoutStored) => void;
  onMedicationsAndSupplementsChange: (next: MedicationsAndSupplementsStored) => void;
}

export function EvolutionArtifactsReviewEditor({
  professionalActions,
  patientHandout,
  medicationsAndSupplements,
  onProfessionalActionsChange,
  onPatientHandoutChange,
  onMedicationsAndSupplementsChange,
}: EvolutionArtifactsReviewEditorProps) {
  const items = professionalActions.items ?? [];
  const medItems = medicationsAndSupplements.items ?? [];

  const updateItem = (index: number, patch: Partial<ProfessionalActionItem>) => {
    const nextItems = items.map((it, i) =>
      i === index ? { ...it, ...patch } : it
    );
    onProfessionalActionsChange(
      normalizeProfessionalActions({
        v: EVOLUTION_ARTIFACTS_VERSION,
        items: nextItems,
      })
    );
  };

  const addItem = () => {
    if (items.length >= 20) return;
    onProfessionalActionsChange({
      v: EVOLUTION_ARTIFACTS_VERSION,
      items: [
        ...items,
        {
          label: "",
          type: undefined,
          rationale: undefined,
          priority: undefined,
          dueHint: undefined,
        },
      ],
    });
  };

  const removeItem = (index: number) => {
    onProfessionalActionsChange({
      v: EVOLUTION_ARTIFACTS_VERSION,
      items: items.filter((_, i) => i !== index),
    });
  };

  const updateMed = (index: number, patch: Partial<MedicationSupplementItem>) => {
    const nextItems = medItems.map((it, i) =>
      i === index ? { ...it, ...patch } : it,
    );
    onMedicationsAndSupplementsChange(
      normalizeMedicationsAndSupplements({
        v: EVOLUTION_ARTIFACTS_VERSION,
        items: nextItems,
        summary: medicationsAndSupplements.summary,
      }),
    );
  };

  const addMed = () => {
    if (medItems.length >= 30) return;
    onMedicationsAndSupplementsChange({
      v: EVOLUTION_ARTIFACTS_VERSION,
      summary: medicationsAndSupplements.summary,
      items: [
        ...medItems,
        {
          name: "",
          kind: "medication",
        },
      ],
    });
  };

  const removeMed = (index: number) => {
    onMedicationsAndSupplementsChange({
      v: EVOLUTION_ARTIFACTS_VERSION,
      summary: medicationsAndSupplements.summary,
      items: medItems.filter((_, i) => i !== index),
    });
  };

  const bulletsText = (patientHandout.bullets ?? []).join("\n");

  return (
    <Card className="bg-card border-border mb-6">
      <CardHeader className="pb-2">
        <CardTitle className="text-foreground flex items-center gap-2 text-base">
          <ListChecks className="h-5 w-5 text-clinical shrink-0" />
          Ações, orientações e medicamentos
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Editáveis aqui e gravados nos campos específicos da evolução. Pontos de ação e
          orientações não entram no PDF; medicamentos e suplementos entram como secção
          destacada no documento (como exames).
        </p>
      </CardHeader>
      <CardContent className="space-y-8">
        <section className="space-y-3 rounded-xl border border-border border-l-4 border-l-clinical bg-muted/80 dark:bg-muted/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              Pontos de ação — profissional
            </h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1 text-black dark:text-black disabled:text-black/50 dark:disabled:text-black/50"
              onClick={addItem}
              disabled={items.length >= 20}
            >
              <Plus className="h-3.5 w-3.5" />
              Adicionar
            </Button>
          </div>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum item. Adicione manualmente ou aguarde a IA ao processar áudio/exames.
            </p>
          ) : (
            <ul className="space-y-4">
              {items.map((item, idx) => (
                <li
                  key={idx}
                  className="rounded-lg border border-border dark:border-border bg-card p-3 space-y-2"
                >
                  <div className="flex justify-between gap-2">
                    <Label className="text-xs text-muted-foreground">
                      Descrição da ação
                    </Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                      onClick={() => removeItem(idx)}
                      aria-label="Remover ação"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <Textarea
                    className="min-h-[56px] text-sm bg-card border-border dark:border-border"
                    value={item.label}
                    onChange={(e) => updateItem(idx, { label: e.target.value })}
                    placeholder="Ex.: Agendar retorno em 15 dias"
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">Tipo</Label>
                      <select
                        className="mt-1 w-full px-3 py-2 rounded-md border border-border dark:border-border bg-card text-sm text-foreground"
                        value={item.type ?? ""}
                        onChange={(e) =>
                          updateItem(idx, {
                            type: e.target.value || undefined,
                          })
                        }
                      >
                        {ACTION_TYPES.map((t) => (
                          <option key={t.value || "empty"} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Prioridade</Label>
                      <select
                        className="mt-1 w-full px-3 py-2 rounded-md border border-border dark:border-border bg-card text-sm text-foreground"
                        value={item.priority ?? ""}
                        onChange={(e) =>
                          updateItem(idx, {
                            priority:
                              e.target.value === "low" ||
                              e.target.value === "medium" ||
                              e.target.value === "high"
                                ? e.target.value
                                : undefined,
                          })
                        }
                      >
                        {PRIORITIES.map((p) => (
                          <option key={p.value || "empty"} value={p.value}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">Prazo / lembrete</Label>
                      <Input
                        className="text-sm bg-card"
                        value={item.dueHint ?? ""}
                        onChange={(e) => updateItem(idx, { dueHint: e.target.value || undefined })}
                        placeholder="Ex.: em 2 semanas"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Notas (opcional)</Label>
                      <Input
                        className="text-sm bg-card"
                        value={item.rationale ?? ""}
                        onChange={(e) =>
                          updateItem(idx, { rationale: e.target.value || undefined })
                        }
                        placeholder="Contexto breve"
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3 rounded-xl border border-border border-l-4 border-l-clinical bg-muted/80 dark:bg-muted/40 p-4">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <UserCircle className="h-4 w-4 text-clinical" />
            Orientações ao paciente (handout)
          </h3>
          <div>
            <Label className="text-xs text-muted-foreground">Resumo (opcional)</Label>
            <Textarea
              className="mt-1 min-h-[72px] text-sm bg-card border-border dark:border-border"
              value={patientHandout.summary ?? ""}
              onChange={(e) =>
                onPatientHandoutChange(
                  normalizePatientHandout({
                    v: EVOLUTION_ARTIFACTS_VERSION,
                    bullets: patientHandout.bullets,
                    summary: e.target.value,
                  })
                )
              }
              placeholder="Parágrafo em linguagem acessível para o paciente"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Pontos (um por linha)</Label>
            <Textarea
              className="mt-1 min-h-[120px] text-sm bg-card border-border dark:border-border"
              value={bulletsText}
              onChange={(e) =>
                onPatientHandoutChange(
                  normalizePatientHandout({
                    v: EVOLUTION_ARTIFACTS_VERSION,
                    summary: patientHandout.summary,
                    bullets: e.target.value.split("\n"),
                  })
                )
              }
              placeholder={
                "Ex.: Tomar medicação conforme prescrito\nProcurar o pronto-socorro se..."
              }
            />
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-border border-l-4 border-l-emerald-600/80 bg-muted/80 dark:bg-muted/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Pill className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
              Medicamentos &amp; suplementos
            </h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1 text-black dark:text-black disabled:text-black/50 dark:disabled:text-black/50"
              onClick={addMed}
              disabled={medItems.length >= 30}
            >
              <Plus className="h-3.5 w-3.5" />
              Adicionar
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Extraídos do áudio, anexos ou texto. Entram no PDF como secção destacada.
          </p>
          <div>
            <Label className="text-xs text-muted-foreground">Resumo (opcional)</Label>
            <Textarea
              className="mt-1 min-h-[56px] text-sm bg-card border-border dark:border-border"
              value={medicationsAndSupplements.summary ?? ""}
              onChange={(e) =>
                onMedicationsAndSupplementsChange(
                  normalizeMedicationsAndSupplements({
                    v: EVOLUTION_ARTIFACTS_VERSION,
                    items: medItems,
                    summary: e.target.value,
                  }),
                )
              }
              placeholder="Contexto terapêutico breve (ex.: polifarmácia, adesão)"
            />
          </div>
          {medItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum item. Adicione manualmente ou aguarde a IA ao processar áudio/anexos.
            </p>
          ) : (
            <ul className="space-y-4">
              {medItems.map((item, idx) => (
                <li
                  key={idx}
                  className="rounded-lg border border-border dark:border-border bg-card p-3 space-y-2"
                >
                  <div className="flex justify-between gap-2">
                    <Label className="text-xs text-muted-foreground">Nome</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                      onClick={() => removeMed(idx)}
                      aria-label="Remover medicamento"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <Input
                    className="text-sm bg-card"
                    value={item.name}
                    onChange={(e) => updateMed(idx, { name: e.target.value })}
                    placeholder="Ex.: Losartana 50 mg"
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">Tipo</Label>
                      <select
                        className="mt-1 w-full px-3 py-2 rounded-md border border-border dark:border-border bg-card text-sm text-foreground"
                        value={item.kind ?? ""}
                        onChange={(e) =>
                          updateMed(idx, {
                            kind:
                              e.target.value === "medication" ||
                              e.target.value === "supplement" ||
                              e.target.value === "other"
                                ? e.target.value
                                : undefined,
                          })
                        }
                      >
                        {MED_KINDS.map((k) => (
                          <option key={k.value || "empty"} value={k.value}>
                            {k.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Dose</Label>
                      <Input
                        className="mt-1 text-sm bg-card"
                        value={item.dose ?? ""}
                        onChange={(e) => updateMed(idx, { dose: e.target.value || undefined })}
                        placeholder="Ex.: 50 mg"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Frequência</Label>
                      <Input
                        className="mt-1 text-sm bg-card"
                        value={item.frequency ?? ""}
                        onChange={(e) =>
                          updateMed(idx, { frequency: e.target.value || undefined })
                        }
                        placeholder="Ex.: 1x/dia"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">Via</Label>
                      <Input
                        className="text-sm bg-card"
                        value={item.route ?? ""}
                        onChange={(e) => updateMed(idx, { route: e.target.value || undefined })}
                        placeholder="Ex.: oral"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Efeitos</Label>
                      <Input
                        className="text-sm bg-card"
                        value={item.effects ?? ""}
                        onChange={(e) =>
                          updateMed(idx, { effects: e.target.value || undefined })
                        }
                        placeholder="Efeitos relatados ou esperados"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">Interações</Label>
                      <Input
                        className="text-sm bg-card"
                        value={item.interactions ?? ""}
                        onChange={(e) =>
                          updateMed(idx, { interactions: e.target.value || undefined })
                        }
                        placeholder="Interações mencionadas"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Observações</Label>
                      <Input
                        className="text-sm bg-card"
                        value={item.notes ?? ""}
                        onChange={(e) => updateMed(idx, { notes: e.target.value || undefined })}
                        placeholder="Notas clínicas"
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
