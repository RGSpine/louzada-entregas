"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Mic } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { updateAppointment, cancelAppointment } from "@/app/actions/appointment";
import { formatBrlFromCents } from "@/components/dashboard/finances/finance-format";
import type { AppointmentCompletionEffects } from "@/lib/finance/appointment-income";
import { formatAppointmentMetaSubtitle } from "@/lib/appointment-visit-meta";
import {
  confirmationBadgeClasses,
  formatConfirmationStatusLabel,
  isPendingConfirmation,
} from "@/lib/appointment-confirmation";
import type { AppointmentConfirmationStatusValue } from "@/lib/appointment-fields-schema";
import { cn } from "@/lib/utils";
import {
  AgendaCardButtonLabel,
  agendaCardActionBtnClass,
  agendaWeekBadgeClass,
  AgendaMotionButton,
} from "@/components/dashboard/agenda-card-actions";
import { agendaStatusBadgeClasses } from "@/components/dashboard/AgendaWeekAppointmentCard";
import type { AgendaWeekAppointmentItem } from "@/components/dashboard/AgendaWeekAppointmentCard";
import { formatAppointmentStatusLabel } from "@/lib/appointment-status";
import { AgendaAppointmentFinanceFab } from "@/components/dashboard/AgendaAppointmentFinanceFab";
import { useAgendaCalendarContext } from "@/components/dashboard/agenda/AgendaCalendarContext";

type Props = {
  item: AgendaWeekAppointmentItem;
  canUseConfirmationColors: boolean;
  statusUpdatingId: string | null;
  onStatusChangeStart: (id: string) => void;
  onStatusChangeEnd: () => void;
  onChanged: () => void | Promise<void>;
  onDeleted?: () => void;
};

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

export function AgendaAppointmentQuickActions({
  item,
  canUseConfirmationColors,
  statusUpdatingId,
  onStatusChangeStart,
  onStatusChangeEnd,
  onChanged,
  onDeleted,
}: Props) {
  const router = useRouter();
  const { appointmentsById } = useAgendaCalendarContext();
  const liveItem = appointmentsById.get(item.id) ?? item;
  const [acting, setActing] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [noShowOpen, setNoShowOpen] = useState(false);
  const [noShowReason, setNoShowReason] = useState("");

  const displayConfirmationStatus: AppointmentConfirmationStatusValue =
    liveItem.status === "COMPLETED" ? "CONFIRMED" : liveItem.confirmationStatus;

  const eligibleForConfirm =
    canUseConfirmationColors &&
    liveItem.status === "SCHEDULED" &&
    isPendingConfirmation(displayConfirmationStatus);

  const busy = acting || statusUpdatingId === liveItem.id;

  async function handleConfirmYes() {
    setActing(true);
    onStatusChangeStart(liveItem.id);
    try {
      const result = await updateAppointment({
        appointmentId: liveItem.id,
        patientId: liveItem.patientId,
        confirmationStatus: "CONFIRMED",
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Marcação confirmada.");
      await onChanged();
    } finally {
      setActing(false);
      onStatusChangeEnd();
    }
  }

  function handleConfirmNo() {
    setDeleteConfirmOpen(false);
    toast.message("Marcação mantida como pendente de confirmação.");
  }

  async function handleDeleteYes() {
    setActing(true);
    onStatusChangeStart(liveItem.id);
    try {
      const result = await cancelAppointment({ appointmentId: liveItem.id });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.data?.removal === "agenda"
          ? "Marcação retirada da agenda. Sessão e financeiro permanecem."
          : "Marcação apagada da agenda e do sistema.",
      );
      setDeleteConfirmOpen(false);
      await onChanged();
      onDeleted?.();
    } finally {
      setActing(false);
      onStatusChangeEnd();
    }
  }

  async function handleMarkCompleted() {
    onStatusChangeStart(liveItem.id);
    try {
      const result = await updateAppointment({
        appointmentId: liveItem.id,
        patientId: liveItem.patientId,
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
          liveItem.priceCents,
          liveItem.visitKind,
        ),
      );
      await onChanged();
    } finally {
      onStatusChangeEnd();
    }
  }

  async function handleMarkNoShow() {
    const reason = noShowReason.trim();
    if (reason.length < 3) {
      toast.error("Informe a justificativa da falta (mínimo 3 caracteres).");
      return;
    }
    setActing(true);
    onStatusChangeStart(liveItem.id);
    try {
      const result = await updateAppointment({
        appointmentId: liveItem.id,
        patientId: liveItem.patientId,
        status: "NO_SHOW",
        noShowReason: reason,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Falta registrada. O horário ficou livre para remarcar.");
      setNoShowOpen(false);
      setNoShowReason("");
      await onChanged();
    } finally {
      setActing(false);
      onStatusChangeEnd();
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold">{liveItem.patientName}</p>
        <p className="text-xs text-muted-foreground">
          {formatAppointmentMetaSubtitle({
            visitKind: liveItem.visitKind,
            careSetting: liveItem.careSetting,
            priceCents: liveItem.priceCents,
            serviceName: liveItem.serviceName,
          })}
        </p>
      </div>

      {liveItem.status !== "CANCELLED" && liveItem.status !== "NO_SHOW" && (
        <div className="relative rounded-md border border-border/80 bg-muted/40 p-3">
          {eligibleForConfirm && (
            <p className="mb-2 text-xs font-medium leading-snug">
              Podemos confirmar esse paciente/evento?
            </p>
          )}
          <div className="flex gap-2">
            {eligibleForConfirm ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 min-w-0 flex-1 bg-success text-xs text-white hover:bg-success/90"
                  disabled={busy}
                  onClick={() => void handleConfirmYes()}
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Sim"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 min-w-0 flex-1 bg-primary text-xs text-primary-foreground hover:bg-primary/90"
                  disabled={busy}
                  onClick={handleConfirmNo}
                >
                  Não
                </Button>
              </>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className={cn(
                "h-8 min-w-0 text-xs",
                eligibleForConfirm ? "flex-1" : "w-full",
              )}
              disabled={busy}
              onClick={() => setDeleteConfirmOpen(true)}
            >
              Excluir marcação
            </Button>
          </div>

          {deleteConfirmOpen && (
            <div
              className="absolute left-3 right-3 top-full z-20 mt-2 rounded-lg border border-border bg-card p-3 shadow-[var(--shadow-elevation-3)]"
              role="alertdialog"
              aria-label="Confirmar exclusão"
            >
              <p className="mb-2 text-center text-xs font-medium leading-snug">
                {liveItem.status === "COMPLETED"
                  ? "Retirar só da agenda? A sessão realizada e o financeiro ficam no sistema."
                  : "Apagar esta marcação da agenda e do sistema?"}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="h-8 flex-1 text-xs"
                  disabled={busy}
                  onClick={() => void handleDeleteYes()}
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Sim"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 flex-1 text-xs"
                  disabled={busy}
                  onClick={() => setDeleteConfirmOpen(false)}
                >
                  Não
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {liveItem.status === "SCHEDULED" && (
        <div className="rounded-md border border-border/80 bg-muted/40 p-3">
          {!noShowOpen ? (
            <>
              <p className="mb-2 text-xs leading-snug text-muted-foreground">
                Paciente confirmou e desmarcou em cima da hora? Registre a falta com a causa relatada.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 w-full text-xs"
                disabled={busy}
                onClick={() => {
                  setDeleteConfirmOpen(false);
                  setNoShowOpen(true);
                }}
              >
                Marcar falta
              </Button>
            </>
          ) : (
            <>
              <p className="mb-2 text-xs font-medium leading-snug">
                Justificativa de não comparecimento
              </p>
              <Textarea
                value={noShowReason}
                onChange={(e) => setNoShowReason(e.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="Ex.: imprevisto familiar, atraso no transporte, desistência no dia…"
                className="mb-2 min-h-[4.5rem] text-sm"
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-8 flex-1 text-xs"
                  disabled={busy}
                  onClick={() => void handleMarkNoShow()}
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Confirmar falta"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 flex-1 text-xs"
                  disabled={busy}
                  onClick={() => {
                    setNoShowOpen(false);
                    setNoShowReason("");
                  }}
                >
                  Voltar
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {liveItem.status === "NO_SHOW" && (
        <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3">
          <p className="text-xs font-medium text-destructive">Falta registrada</p>
          {liveItem.noShowReason ? (
            <p className="mt-1 text-xs leading-snug text-muted-foreground">{liveItem.noShowReason}</p>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="mt-2 h-8 w-full text-xs"
            disabled={busy}
            onClick={() => setDeleteConfirmOpen(true)}
          >
            Excluir marcação
          </Button>
          {deleteConfirmOpen && (
            <div className="mt-2 rounded-lg border border-border bg-card p-3 shadow-[var(--shadow-elevation-3)]">
              <p className="mb-2 text-center text-xs font-medium leading-snug">
                Apagar o registro desta falta da agenda e do sistema?
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="h-8 flex-1 text-xs"
                  disabled={busy}
                  onClick={() => void handleDeleteYes()}
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Sim"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 flex-1 text-xs"
                  disabled={busy}
                  onClick={() => setDeleteConfirmOpen(false)}
                >
                  Não
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {canUseConfirmationColors && liveItem.status !== "CANCELLED" && liveItem.status !== "NO_SHOW" && (
          <Badge
            variant="outline"
            className={cn(confirmationBadgeClasses(displayConfirmationStatus), agendaWeekBadgeClass)}
          >
            {formatConfirmationStatusLabel(displayConfirmationStatus)}
          </Badge>
        )}
        <Badge
          variant={
            liveItem.status === "COMPLETED"
              ? "default"
              : liveItem.status === "CANCELLED" || liveItem.status === "NO_SHOW"
                ? "secondary"
                : "outline"
          }
          className={cn(agendaStatusBadgeClasses(liveItem.status, canUseConfirmationColors), agendaWeekBadgeClass)}
        >
          {formatAppointmentStatusLabel(liveItem.status)}
        </Badge>
        {liveItem.hasEvolution && (
          <Badge variant="outline" className={cn(agendaWeekBadgeClass, "border-success/40 text-success")}>
            Evoluída
          </Badge>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {!liveItem.hasEvolution && liveItem.status === "COMPLETED" && (
          <AgendaMotionButton
            className={agendaCardActionBtnClass}
            onClick={() =>
              router.push(`/dashboard/new-evolution?appointmentId=${encodeURIComponent(liveItem.id)}`)
            }
          >
            <AgendaCardButtonLabel icon={<Mic className="size-3.5" aria-hidden />}>
              Nova evolução
            </AgendaCardButtonLabel>
          </AgendaMotionButton>
        )}
        {!liveItem.hasEvolution && liveItem.status === "SCHEDULED" && (
          <p className="text-[11px] leading-snug text-muted-foreground px-0.5">
            Marque como Realizada para abrir a evolução e cadastrar/vincular o paciente.
          </p>
        )}
        {liveItem.hasEvolution && (
          <AgendaMotionButton className={agendaCardActionBtnClass} asChild>
            <Link href={`/dashboard/patients/${liveItem.patientId}`}>
              <AgendaCardButtonLabel>Ver na ficha</AgendaCardButtonLabel>
            </Link>
          </AgendaMotionButton>
        )}
        {liveItem.status === "SCHEDULED" && (
          <AgendaMotionButton
            className={agendaCardActionBtnClass}
            disabled={busy}
            onClick={() => void handleMarkCompleted()}
          >
            {busy ? (
              <AgendaCardButtonLabel icon={<Loader2 className="size-3.5 animate-spin" aria-hidden />}>
                A processar…
              </AgendaCardButtonLabel>
            ) : (
              <AgendaCardButtonLabel>Marcar realizada</AgendaCardButtonLabel>
            )}
          </AgendaMotionButton>
        )}

        <AgendaAppointmentFinanceFab
          appointmentId={liveItem.id}
          visitKind={liveItem.visitKind}
          priceCents={liveItem.priceCents}
          professionalServiceId={liveItem.professionalServiceId}
          hasFinanceIncome={liveItem.hasFinanceIncome}
          status={liveItem.status}
          disabled={busy}
          onChanged={onChanged}
          buttonClassName={agendaCardActionBtnClass}
        />
      </div>
    </div>
  );
}
