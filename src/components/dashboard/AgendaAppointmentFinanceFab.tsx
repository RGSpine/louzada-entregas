"use client";

import { useCallback, useState } from "react";
import { Banknote, Loader2, Package, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { registerAppointmentFinanceInAgenda } from "@/app/actions/appointment";
import { METHOD_PT } from "@/components/dashboard/finances/finance-format";
import { cn } from "@/lib/utils";
import {
  AgendaCardButtonLabel,
  agendaCardActionBtnClass,
} from "@/components/dashboard/agenda-card-actions";
import type { AppointmentStatusValue } from "@/lib/appointment-status";
import type { AppointmentVisitKindValue } from "@/lib/appointment-fields-schema";
import type { FinancialTransactionMethod } from "@prisma/client";

type Props = {
  appointmentId: string;
  visitKind: AppointmentVisitKindValue;
  priceCents: number | null;
  professionalServiceId: string | null;
  hasFinanceIncome: boolean;
  status: AppointmentStatusValue;
  disabled?: boolean;
  onChanged: () => void | Promise<void>;
  buttonClassName?: string;
};

type PendingAction = "register_income" | "single_sale" | "package_sale";

const PAYMENT_OPTIONS = Object.entries(METHOD_PT) as Array<[FinancialTransactionMethod, string]>;

export function AgendaAppointmentFinanceFab({
  appointmentId,
  visitKind,
  priceCents,
  professionalServiceId,
  hasFinanceIncome,
  status,
  disabled,
  onChanged,
  buttonClassName,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [acting, setActing] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<FinancialTransactionMethod>("PIX");
  const [packageSessions, setPackageSessions] = useState("4");

  const isCashKind = visitKind === "UNIQUE_CONSULTATION" || visitKind === "RETURN";
  const canRegisterIncome = isCashKind && !hasFinanceIncome && (priceCents ?? 0) > 0;
  const canSell = !hasFinanceIncome && Boolean(professionalServiceId);
  const visible = status !== "CANCELLED" && status !== "NO_SHOW" && (canRegisterIncome || canSell || isCashKind);

  const showMenu = visible && (open || pinned);

  const resetFlow = useCallback(() => {
    setPendingAction(null);
    setPaymentMethod("PIX");
    setPackageSessions("4");
  }, []);

  const closeMenu = useCallback(() => {
    if (pinned) return;
    setOpen(false);
    resetFlow();
  }, [pinned, resetFlow]);

  const closeAll = useCallback(() => {
    setPinned(false);
    setOpen(false);
    resetFlow();
  }, [resetFlow]);

  if (!visible) return null;

  async function handleConfirm() {
    if (!pendingAction) return;

    if (pendingAction === "package_sale") {
      const sessions = Number(packageSessions);
      if (!Number.isFinite(sessions) || sessions < 2 || sessions > 52) {
        toast.error("Informe entre 2 e 52 sessões.");
        return;
      }
    }

    setActing(true);
    try {
      const result = await registerAppointmentFinanceInAgenda({
        appointmentId,
        action: pendingAction,
        professionalServiceId: professionalServiceId ?? undefined,
        agreedPriceCents: priceCents ?? undefined,
        sessionCountTotal:
          pendingAction === "package_sale" ? Number(packageSessions) : undefined,
        paymentMethod,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(result.data?.message ?? "Registrado no financeiro.");
      closeAll();
      await onChanged();
    } finally {
      setActing(false);
    }
  }

  function startAction(action: PendingAction) {
    setPendingAction(action);
    setOpen(true);
    setPinned(true);
  }

  return (
    <div
      className="relative flex min-w-0 w-full max-w-full flex-col items-stretch gap-1"
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={closeMenu}
    >
      <Button
        type="button"
        size="sm"
        variant="default"
        className={cn(agendaCardActionBtnClass, buttonClassName)}
        disabled={disabled || acting}
        onClick={() => {
          if (pinned && pendingAction) {
            closeAll();
            return;
          }
          setPinned((p) => !p);
          setOpen(true);
        }}
      >
        <AgendaCardButtonLabel
          icon={
            acting ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Banknote className="size-3.5" aria-hidden />
            )
          }
        >
          Registrar no financeiro
        </AgendaCardButtonLabel>
      </Button>

      {showMenu && !pendingAction && (
        <div className="flex min-w-0 w-full max-w-full flex-col gap-1 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-[var(--shadow-elevation-2)]">
          {canRegisterIncome && (
            <button
              type="button"
              className="flex items-center gap-1.5 rounded px-2 py-1.5 text-left text-[11px] text-popover-foreground hover:bg-muted"
              disabled={acting}
              onClick={() => startAction("register_income")}
            >
              <Receipt className="h-3 w-3 shrink-0" aria-hidden />
              Entrada no caixa
            </button>
          )}
          {canSell && (
            <>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded px-2 py-1.5 text-left text-[11px] text-popover-foreground hover:bg-muted"
                disabled={acting}
                onClick={() => startAction("single_sale")}
              >
                <Receipt className="h-3 w-3 shrink-0" aria-hidden />
                Venda avulsa (1 sessão)
              </button>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded px-2 py-1.5 text-left text-[11px] text-popover-foreground hover:bg-muted"
                disabled={acting}
                onClick={() => startAction("package_sale")}
              >
                <Package className="h-3 w-3 shrink-0" aria-hidden />
                Vender pacote
              </button>
            </>
          )}
          {!canRegisterIncome && !canSell && (
            <p className="max-w-full px-2 py-1 text-[10px] text-muted-foreground">
              {hasFinanceIncome
                ? "Receita já registrada."
                : "Edite a marcação e selecione o serviço do catálogo."}
            </p>
          )}
        </div>
      )}

      {showMenu && pendingAction && (
        <div
          className="min-w-0 w-full max-w-full space-y-2 rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-[var(--shadow-elevation-2)]"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-[11px] font-medium text-popover-foreground">
            {pendingAction === "register_income" && "Entrada no caixa"}
            {pendingAction === "single_sale" && "Venda avulsa"}
            {pendingAction === "package_sale" && "Vender pacote"}
          </p>

          {pendingAction === "package_sale" && (
            <div className="space-y-1">
              <Label htmlFor={`pkg-sessions-${appointmentId}`} className="text-[10px]">
                Nº de sessões
              </Label>
              <Input
                id={`pkg-sessions-${appointmentId}`}
                type="number"
                min={2}
                max={52}
                inputMode="numeric"
                value={packageSessions}
                onChange={(e) => setPackageSessions(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor={`pay-method-${appointmentId}`} className="text-[10px]">
              Forma de pagamento
            </Label>
            <select
              id={`pay-method-${appointmentId}`}
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as FinancialTransactionMethod)}
              className="w-full h-8 rounded-md border border-input bg-transparent px-2 text-xs text-popover-foreground"
            >
              {PAYMENT_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-1.5 pt-1">
            <Button
              type="button"
              size="sm"
              className="h-7 flex-1 text-[11px]"
              disabled={acting}
              onClick={() => void handleConfirm()}
            >
              {acting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirmar"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={cn("h-7 flex-1 text-[11px]", buttonClassName)}
              disabled={acting}
              onClick={closeAll}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
