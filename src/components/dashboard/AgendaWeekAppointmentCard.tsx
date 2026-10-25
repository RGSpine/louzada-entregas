"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Mic, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cancelAppointment, updateAppointment } from "@/app/actions/appointment";
import { formatBrlFromCents } from "@/components/dashboard/finances/finance-format";
import type { AppointmentCompletionEffects } from "@/lib/finance/appointment-income";
import { formatAppointmentMetaSubtitle } from "@/lib/appointment-visit-meta";
import {
  appointmentCardSurfaceClasses,
  confirmationBadgeClasses,
  formatConfirmationStatusLabel,
  isPendingConfirmation,
} from "@/lib/appointment-confirmation";
import type {
  AppointmentCareSettingValue,
  AppointmentConfirmationStatusValue,
  AppointmentVisitKindValue,
} from "@/lib/appointment-fields-schema";
import { cn } from "@/lib/utils";
import {
  AgendaCardButtonLabel,
  agendaCardActionBtnClass,
  agendaWeekBadgeClass,
} from "@/components/dashboard/agenda-card-actions";
import { formatAppointmentStatusLabel, type AppointmentStatusValue } from "@/lib/appointment-status";
import { AgendaAppointmentFinanceFab } from "@/components/dashboard/AgendaAppointmentFinanceFab";

/** Badge de status (Agendada / Realizada) legível sobre fundo amarelo/verde. */
export function agendaStatusBadgeClasses(
  status: AgendaWeekAppointmentItem["status"],
  colorsEnabled: boolean,
): string {
  const base = "uppercase tracking-wide";
  if (!colorsEnabled) return base;
  if (status === "SCHEDULED") {
    return cn(
      base,
      "border-border text-foreground bg-white/40",
      "dark:border-white dark:text-white dark:bg-white/10",
    );
  }
  if (status === "COMPLETED") {
    return cn(base, "dark:border-white dark:text-white");
  }
  if (status === "NO_SHOW") {
    return cn(base, "border-destructive/40 text-destructive bg-destructive/10", "dark:border-destructive/50 dark:text-destructive");
  }
  return cn(base, "dark:border-white/80 dark:text-white/90");
}

export type AgendaWeekAppointmentItem = {
  id: string;
  patientId: string;
  patientName: string;
  patientAgendaColor: string;
  /** Cor do profissional que atende (agenda de equipe); prioridade sobre a do paciente. */
  professionalColor?: string | null;
  /** Nome do profissional que atende (agenda de equipe). */
  professionalName?: string | null;
  /** Quem originou a marcação. */
  createdByName?: string | null;
  /** Intra User (profissional) responsável pelo atendimento. */
  intraUserId?: string | null;
  startAt: Date;
  endAt: Date;
  status: AppointmentStatusValue;
  title: string | null;
  visitKind: AppointmentVisitKindValue;
  careSetting: AppointmentCareSettingValue;
  priceCents: number | null;
  serviceName: string | null;
  professionalServiceId: string | null;
  hasFinanceIncome: boolean;
  confirmationStatus: AppointmentConfirmationStatusValue;
  evolutionId: string | null;
  hasEvolution: boolean;
  /** Espaço de Serviços (Consultório/Clínica). */
  serviceSpaceId?: string | null;
  serviceSpaceName?: string | null;
  serviceSpaceColor?: string | null;
  noShowReason?: string | null;
  recurrenceSeriesId?: string | null;
};

type Props = {
  item: AgendaWeekAppointmentItem;
  formatLocalHour: (date: Date) => string;
  canUseConfirmationColors: boolean;
  statusUpdatingId: string | null;
  outlineBtnClass?: string;
  onEdit: () => void;
  onStatusChangeStart: (id: string) => void;
  onStatusChangeEnd: () => void;
  onChanged: () => void | Promise<void>;
};

type PromptStep = "confirm" | "delete";

function buildCompletionToastMessage(
  effects: AppointmentCompletionEffects | undefined,
  priceCents: number | null,
  visitKind: AgendaWeekAppointmentItem["visitKind"],
): string {
  if (effects?.incomeRegistered && effects.incomeAmountCents) {
    return `Marcação concluída. ${formatBrlFromCents(effects.incomeAmountCents)} registrado no financeiro.`;
  }
  if (effects?.sessionConsumed) {
    return "Marcação concluída. Sessão de pacote debitada no financeiro.";
  }
  if (
    (visitKind === "UNIQUE_CONSULTATION" || visitKind === "RETURN") &&
    priceCents != null &&
    priceCents > 0
  ) {
    return "Marcação concluída. Receita já estava registrada no financeiro.";
  }
  return "Marcação concluída.";
}

export function AgendaWeekAppointmentCard({
  item,
  formatLocalHour,
  canUseConfirmationColors,
  statusUpdatingId,
  outlineBtnClass,
  onEdit,
  onStatusChangeStart,
  onStatusChangeEnd,
  onChanged,
}: Props) {
  const router = useRouter();
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptPinned, setPromptPinned] = useState(false);
  const [promptStep, setPromptStep] = useState<PromptStep>("confirm");
  const [acting, setActing] = useState(false);

  const displayConfirmationStatus: AppointmentConfirmationStatusValue =
    item.status === "COMPLETED" ? "CONFIRMED" : item.confirmationStatus;

  const eligibleForPrompt =
    canUseConfirmationColors &&
    item.status === "SCHEDULED" &&
    isPendingConfirmation(displayConfirmationStatus);

  const showPrompt = eligibleForPrompt && promptOpen;

  const openPrompt = useCallback(
    (step: PromptStep = "confirm") => {
      if (!eligibleForPrompt) return;
      setPromptStep(step);
      setPromptOpen(true);
    },
    [eligibleForPrompt],
  );

  const closePrompt = useCallback(() => {
    if (promptPinned) return;
    setPromptOpen(false);
    setPromptStep("confirm");
  }, [promptPinned]);

  const forceClosePrompt = useCallback(() => {
    setPromptPinned(false);
    setPromptOpen(false);
    setPromptStep("confirm");
  }, []);

  function handleCardClick() {
    if (!eligibleForPrompt) return;
    setPromptPinned(true);
    openPrompt("confirm");
  }

  async function handleConfirmYes() {
    setActing(true);
    onStatusChangeStart(item.id);
    try {
      const result = await updateAppointment({
        appointmentId: item.id,
        patientId: item.patientId,
        confirmationStatus: "CONFIRMED",
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Marcação confirmada.");
      forceClosePrompt();
      await onChanged();
    } finally {
      setActing(false);
      onStatusChangeEnd();
    }
  }

  async function handleQuickCancel() {
    const label = `${item.patientName} (${formatLocalHour(item.startAt)}–${formatLocalHour(item.endAt)})`;
    if (!window.confirm(`Remover marcação de ${label}?`)) return;
    await handleDeleteYes();
  }

  async function handleDeleteYes() {
    setActing(true);
    onStatusChangeStart(item.id);
    try {
      const result = await cancelAppointment({ appointmentId: item.id });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.data?.removal === "agenda"
          ? "Marcação retirada da agenda. Sessão e financeiro permanecem."
          : "Marcação apagada da agenda e do sistema.",
      );
      forceClosePrompt();
      await onChanged();
    } finally {
      setActing(false);
      onStatusChangeEnd();
    }
  }

  async function handleMarkCompleted() {
    onStatusChangeStart(item.id);
    try {
      const result = await updateAppointment({
        appointmentId: item.id,
        patientId: item.patientId,
        status: "COMPLETED",
        confirmationStatus: "CONFIRMED",
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(
        buildCompletionToastMessage(
          result.data?.completionEffects,
          item.priceCents,
          item.visitKind,
        ),
      );
      await onChanged();
    } finally {
      onStatusChangeEnd();
    }
  }

  const busy = acting || statusUpdatingId === item.id;

  return (
    <div
      className={cn(
        "group relative min-w-0 rounded-md py-1.5 pr-14 pb-2 space-y-1.5 transition-colors pl-2",
        appointmentCardSurfaceClasses(displayConfirmationStatus, canUseConfirmationColors),
        item.status === "CANCELLED" && "opacity-60",
        eligibleForPrompt && "cursor-pointer",
      )}
      style={{
        boxShadow: `inset 4px 0 0 0 ${item.serviceSpaceColor ?? item.professionalColor ?? item.patientAgendaColor}`,
      }}
      onMouseEnter={() => openPrompt("confirm")}
      onMouseLeave={closePrompt}
      onClick={handleCardClick}
      role={eligibleForPrompt ? "button" : undefined}
      tabIndex={eligibleForPrompt ? 0 : undefined}
      onKeyDown={(e) => {
        if (!eligibleForPrompt) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleCardClick();
        }
      }}
    >
      <div className="absolute top-1 right-1 flex gap-0.5" onClick={(e) => e.stopPropagation()}>
        {item.status === "SCHEDULED" && (
          <button
            type="button"
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-md",
              "text-muted-foreground hover:bg-muted/80 hover:text-foreground",
              "dark:text-muted-foreground dark:hover:bg-muted/80 dark:hover:text-foreground",
              busy && "pointer-events-none opacity-50",
            )}
            aria-label={`Editar marcação de ${item.patientName}`}
            disabled={busy}
            onClick={onEdit}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
        <button
          type="button"
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-md",
            "text-muted-foreground hover:bg-muted/80 hover:text-foreground",
            "dark:text-muted-foreground dark:hover:bg-muted/80 dark:hover:text-foreground",
            busy && "pointer-events-none opacity-50",
          )}
          aria-label={`Remover marcação de ${item.patientName}`}
          disabled={busy}
          onClick={() => void handleQuickCancel()}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <p className="text-sm font-medium pr-1 break-words leading-snug">
        {formatLocalHour(item.startAt)}–{formatLocalHour(item.endAt)} · {item.patientName}
      </p>
      <p className="text-xs text-muted-foreground break-words leading-snug">
        {formatAppointmentMetaSubtitle({
          visitKind: item.visitKind,
          careSetting: item.careSetting,
          priceCents: item.priceCents,
          serviceName: item.serviceName,
        })}
      </p>
      {item.serviceSpaceName && (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-foreground/80">
          <span
            className="inline-block h-2 w-2 rounded-full ring-1 ring-black/10"
            style={{ backgroundColor: item.serviceSpaceColor ?? "#0F766E" }}
            aria-hidden
          />
          {item.serviceSpaceName}
        </span>
      )}
      {item.title && <p className="text-xs text-muted-foreground">{item.title}</p>}

      {showPrompt && (
        <div
          className="rounded-md border border-border/80 bg-white/95 p-2.5 shadow-sm dark:border-border dark:bg-card/95"
          onClick={(e) => e.stopPropagation()}
        >
          {promptStep === "confirm" ? (
            <>
              <p className="text-[11px] font-medium leading-snug text-foreground mb-2 break-words">
                Podemos confirmar esse paciente/evento?
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-7 flex-1 bg-success hover:bg-success/90 text-white text-xs"
                  disabled={busy}
                  onClick={() => void handleConfirmYes()}
                >
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Sim"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={cn("h-7 flex-1 text-xs", outlineBtnClass)}
                  disabled={busy}
                  onClick={() => setPromptStep("delete")}
                >
                  Não
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs font-medium text-foreground mb-2">
                Deseja excluir essa marcação?
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="h-7 flex-1 text-xs"
                  disabled={busy}
                  onClick={() => void handleDeleteYes()}
                >
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Sim"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={cn("h-7 flex-1 text-xs", outlineBtnClass)}
                  disabled={busy}
                  onClick={forceClosePrompt}
                >
                  Não
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="min-w-0 space-y-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-1.5">
          {canUseConfirmationColors && item.status !== "CANCELLED" && item.status !== "NO_SHOW" && (
            <Badge
              variant="outline"
              className={cn(confirmationBadgeClasses(displayConfirmationStatus), agendaWeekBadgeClass)}
            >
              {formatConfirmationStatusLabel(displayConfirmationStatus)}
            </Badge>
          )}
          <Badge
            variant={
              item.status === "COMPLETED"
                ? "default"
                : item.status === "CANCELLED" || item.status === "NO_SHOW"
                  ? "secondary"
                  : "outline"
            }
            className={cn(agendaStatusBadgeClasses(item.status, canUseConfirmationColors), agendaWeekBadgeClass)}
          >
            {formatAppointmentStatusLabel(item.status)}
          </Badge>
          {item.hasEvolution && (
            <Badge
              variant="outline"
              className={cn(
                agendaWeekBadgeClass,
                "border-success/40 text-success",
              )}
            >
              Evoluída
            </Badge>
          )}
        </div>

        <div className="flex min-w-0 w-full flex-col gap-1.5">
            {!item.hasEvolution && item.status === "COMPLETED" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={cn(agendaCardActionBtnClass, outlineBtnClass)}
                onClick={() =>
                  router.push(`/dashboard/new-evolution?appointmentId=${encodeURIComponent(item.id)}`)
                }
              >
                <AgendaCardButtonLabel
                  icon={<Mic className="size-3.5 text-primary dark:text-primary" aria-hidden />}
                >
                  Nova evolução
                </AgendaCardButtonLabel>
              </Button>
            )}
            {!item.hasEvolution && item.status === "SCHEDULED" && (
              <p className="text-[11px] leading-snug text-muted-foreground">
                Marque como Realizada para abrir a evolução e cadastrar/vincular o paciente.
              </p>
            )}
            {item.hasEvolution && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={cn(agendaCardActionBtnClass, outlineBtnClass)}
                asChild
              >
                <Link href={`/dashboard/patients/${item.patientId}`}>
                  <AgendaCardButtonLabel>Ver na ficha</AgendaCardButtonLabel>
                </Link>
              </Button>
            )}
            {item.status === "SCHEDULED" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={cn(agendaCardActionBtnClass, outlineBtnClass)}
                disabled={busy}
                onClick={() => void handleMarkCompleted()}
              >
                {busy ? (
                  <AgendaCardButtonLabel
                    icon={<Loader2 className="size-3.5 animate-spin" aria-hidden />}
                  >
                    A processar…
                  </AgendaCardButtonLabel>
                ) : (
                  <AgendaCardButtonLabel>Marcar realizada</AgendaCardButtonLabel>
                )}
              </Button>
            )}

          <AgendaAppointmentFinanceFab
            appointmentId={item.id}
            visitKind={item.visitKind}
            priceCents={item.priceCents}
            professionalServiceId={item.professionalServiceId}
            hasFinanceIncome={item.hasFinanceIncome}
            status={item.status}
            disabled={busy}
            onChanged={onChanged}
            buttonClassName={cn(agendaCardActionBtnClass, outlineBtnClass)}
          />
        </div>
      </div>
    </div>
  );
}
