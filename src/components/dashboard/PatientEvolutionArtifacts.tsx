"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ListChecks,
  UserCircle,
  Pill,
  Copy,
  Mail,
  MessageCircle,
  Download,
  Check,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { toggleProfessionalActionItemCompleted } from "@/app/actions/patient";
import type {
  MedicationsAndSupplementsStored,
  PatientHandoutStored,
  ProfessionalActionsStored,
} from "@/lib/evolution-artifacts";
import {
  formatProfessionalActionTypeLabel,
  professionalActionPriorityDisplay,
} from "@/lib/evolution-artifacts";

function buildPatientHandoutText(
  patientName: string,
  handout: PatientHandoutStored
): string {
  const lines: string[] = [
    `Orientações — ${patientName}`,
    "",
  ];
  if (handout.summary) {
    lines.push(handout.summary, "");
  }
  handout.bullets.forEach((b, i) => {
    lines.push(`${i + 1}. ${b}`);
  });
  return lines.join("\n").trim();
}

interface PatientEvolutionArtifactsProps {
  patientName: string;
  professionalActions: ProfessionalActionsStored | null | undefined;
  patientHandout: PatientHandoutStored | null | undefined;
  medicationsAndSupplements?: MedicationsAndSupplementsStored | null;
  /** Quando definidos, cada item mostra check para marcar conclusão (persiste na última evolução). */
  patientId?: string;
  latestEvolutionId?: string | null;
  onPersistedChange?: () => void | Promise<void>;
}

export function PatientEvolutionArtifacts({
  patientName,
  professionalActions,
  patientHandout,
  medicationsAndSupplements,
  patientId,
  latestEvolutionId,
  onPersistedChange,
}: PatientEvolutionArtifactsProps) {
  const [pendingIdx, setPendingIdx] = useState<number | null>(null);
  const canToggleChecks = Boolean(patientId && latestEvolutionId);

  const handleToggleAction = async (itemIndex: number) => {
    if (!patientId || !latestEvolutionId) return;
    setPendingIdx(itemIndex);
    try {
      const result = await toggleProfessionalActionItemCompleted(patientId, itemIndex);
      if (!result.success) {
        toast.error(result.error || "Não foi possível atualizar a ação");
        return;
      }
      toast.success("Status da ação atualizado");
      await onPersistedChange?.();
    } finally {
      setPendingIdx(null);
    }
  };
  const hasProf =
    professionalActions && professionalActions.items.length > 0;
  const hasPatient =
    patientHandout &&
    (patientHandout.bullets.length > 0 ||
      (patientHandout.summary && patientHandout.summary.trim().length > 0));
  const hasMeds =
    medicationsAndSupplements &&
    (medicationsAndSupplements.items.length > 0 ||
      Boolean(medicationsAndSupplements.summary?.trim()));

  const handoutPlain = useMemo(() => {
    if (!patientHandout || !hasPatient) return "";
    return buildPatientHandoutText(patientName, patientHandout);
  }, [patientName, patientHandout, hasPatient]);

  const copyHandout = async () => {
    if (!handoutPlain) return;
    try {
      await navigator.clipboard.writeText(handoutPlain);
      toast.success("Texto copiado para a área de transferência.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  const downloadTxt = () => {
    if (!handoutPlain) return;
    const blob = new Blob([handoutPlain], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orientacoes-${patientName.replace(/[^\w\-]+/g, "-").slice(0, 40)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Arquivo .txt baixado.");
  };

  const mailtoLink = useMemo(() => {
    if (!handoutPlain) return "#";
    const subject = encodeURIComponent(
      `Orientações de cuidado — ${patientName}`
    );
    const body = encodeURIComponent(handoutPlain);
    return `mailto:?subject=${subject}&body=${body}`;
  }, [handoutPlain, patientName]);

  const whatsappLink = useMemo(() => {
    if (!handoutPlain) return "#";
    return `https://wa.me/?text=${encodeURIComponent(handoutPlain)}`;
  }, [handoutPlain]);

  if (!hasProf && !hasPatient && !hasMeds) {
    return (
      <Card
        id="evolucao-artifacts"
        className="bg-card border-border mb-8 scroll-mt-24"
      >
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2 text-foreground/90 dark:text-foreground">
            <ListChecks className="h-5 w-5 text-muted-foreground" />
            Ações, orientações e medicamentos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Nenhuma ação, orientação ou medicamento foi extraído na última evolução.
            Eles aparecem automaticamente quando a IA identificar conteúdo adequado
            ao gerar a evolução.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div
      id="evolucao-artifacts"
      className="space-y-6 mb-8 scroll-mt-24"
    >
      {(hasProf || hasPatient) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {hasProf && (
        <Card className="bg-card border-border border-l-4 border-l-clinical">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-foreground">
              <ListChecks className="h-5 w-5 text-clinical" />
              Para você (profissional)
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Pontos de ação sugeridos com base na última evolução. Gerencie as{" "}
              <a
                href="/dashboard/profile#notificacoes-push"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                notificações push em Meu Perfil
              </a>{" "}
              para receber lembretes.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-2 text-sm">
              {professionalActions!.items.map((item, idx) => (
                <li
                  key={`${item.label}-${idx}`}
                  className={cn(
                    "flex gap-2 rounded-lg bg-muted dark:bg-muted/80 p-3 border border-border/80 dark:border-border",
                    item.completed === true && "opacity-75 border-border/60 dark:border-border"
                  )}
                >
                  {canToggleChecks && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className={cn(
                        "h-9 w-9 shrink-0 rounded-full border-2",
                        item.completed === true
                          ? "border-clinical bg-clinical/15 text-clinical dark:text-clinical"
                          : "border-border dark:border-border text-muted-foreground hover:border-clinical"
                      )}
                      disabled={pendingIdx === idx}
                      aria-pressed={item.completed === true}
                      aria-label={
                        item.completed === true
                          ? "Marcar ação como pendente"
                          : "Marcar ação como concluída"
                      }
                      onClick={() => handleToggleAction(idx)}
                    >
                      {pendingIdx === idx ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4" strokeWidth={2.5} />
                      )}
                    </Button>
                  )}
                  <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span
                      className={cn(
                        "font-medium text-foreground",
                        item.completed === true && "line-through text-muted-foreground"
                      )}
                    >
                      {item.label}
                    </span>
                    {(() => {
                      const priorityUi = professionalActionPriorityDisplay(item.priority);
                      if (!priorityUi) return null;
                      return (
                        <Badge
                          variant="outline"
                          className={cn("text-[10px] font-medium capitalize", priorityUi.className)}
                        >
                          {priorityUi.label}
                        </Badge>
                      );
                    })()}
                    {(() => {
                      const typeLabel = formatProfessionalActionTypeLabel(item.type);
                      if (!typeLabel) return null;
                      return (
                        <span className="text-[10px] text-muted-foreground">{typeLabel}</span>
                      );
                    })()}
                  </div>
                  {item.rationale && (
                    <p className="text-xs text-muted-foreground">
                      {item.rationale}
                    </p>
                  )}
                  {item.dueHint && (
                    <p className="mt-1 text-[11px] text-success">
                      Prazo: {item.dueHint}
                    </p>
                  )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {hasPatient && patientHandout && (
        <Card className="bg-card border-border border-l-4 border-l-clinical">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-foreground">
              <UserCircle className="h-5 w-5 text-clinical" />
              Para o paciente
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Linguagem acessível para compartilhar — distinto das suas tarefas
              internas.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {patientHandout.summary && (
              <p className="text-sm text-foreground/90 dark:text-foreground leading-relaxed">
                {patientHandout.summary}
              </p>
            )}
            <ul className="list-decimal pl-5 space-y-2 text-sm text-foreground/90 dark:text-foreground">
              {patientHandout.bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 text-black dark:text-black disabled:text-black/50 dark:disabled:text-black/50"
                onClick={copyHandout}
              >
                <Copy className="h-3.5 w-3.5" />
                Copiar
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-black dark:text-black disabled:text-black/50 dark:disabled:text-black/50"
                asChild
              >
                <a href={mailtoLink}>
                  <Mail className="h-3.5 w-3.5 mr-1.5 inline" />
                  E-mail
                </a>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-black dark:text-black disabled:text-black/50 dark:disabled:text-black/50"
                asChild
              >
                <a
                  href={whatsappLink}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle className="h-3.5 w-3.5 mr-1.5 inline" />
                  WhatsApp
                </a>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 text-black dark:text-black disabled:text-black/50 dark:disabled:text-black/50"
                onClick={downloadTxt}
              >
                <Download className="h-3.5 w-3.5" />
                .txt
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
        </div>
      )}

      {hasMeds && medicationsAndSupplements && (
        <Card className="bg-card border-border border-l-4 border-l-emerald-600/80">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-foreground">
              <Pill className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />
              Medicamentos &amp; suplementos
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Extraídos da última evolução — também constam como secção destacada no PDF.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {medicationsAndSupplements.summary && (
              <p className="text-sm text-foreground/90 dark:text-foreground leading-relaxed">
                {medicationsAndSupplements.summary}
              </p>
            )}
            <ul className="space-y-2 text-sm">
              {medicationsAndSupplements.items.map((item, idx) => {
                const kindLabel =
                  item.kind === "supplement"
                    ? "Suplemento"
                    : item.kind === "other"
                      ? "Outro"
                      : item.kind === "medication"
                        ? "Medicamento"
                        : null;
                return (
                  <li
                    key={`${item.name}-${idx}`}
                    className="rounded-lg bg-muted dark:bg-muted/80 p-3 border border-border/80 dark:border-border"
                  >
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-medium text-foreground">{item.name}</span>
                      {kindLabel && (
                        <Badge variant="secondary" className="text-[10px]">
                          {kindLabel}
                        </Badge>
                      )}
                    </div>
                    <div className="space-y-0.5 text-xs text-muted-foreground">
                      {item.dose && <p>Dose: {item.dose}</p>}
                      {item.frequency && <p>Frequência: {item.frequency}</p>}
                      {item.route && <p>Via: {item.route}</p>}
                      {item.effects && <p>Efeitos: {item.effects}</p>}
                      {item.interactions && <p>Interações: {item.interactions}</p>}
                      {item.notes && <p>Obs.: {item.notes}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
