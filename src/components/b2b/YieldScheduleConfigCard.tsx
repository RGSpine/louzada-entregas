"use client";

import { useMemo, useState, useTransition } from "react";
import { DateTime } from "luxon";
import {
  CalendarDays,
  Loader2,
  Percent,
  Plus,
  Trash2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  deleteYieldOfferWindow,
  getYieldDashboard,
  saveYieldConfig,
  saveYieldOfferWindow,
  withdrawMarketplaceSlot,
} from "@/app/actions/yield-config";
import {
  DEFAULT_YIELD_CONFIG,
  WEEKDAY_OPTIONS,
  formatWeekdaysLabel,
  type YieldConfigData,
  type YieldDashboardData,
  type YieldMarketplaceSlotRow,
  type YieldOfferWindowData,
} from "@/lib/marketplace/yield-schema";
import {
  minutesToTimeLabel,
  timeLabelToMinutes,
} from "@/lib/marketplace/slot-grid";
import { DEFAULT_SCHEDULE_TIMEZONE } from "@/lib/schedule-temporal-parse";
import Link from "next/link";

function YieldToggle({
  enabled,
  busy,
  onToggle,
}: {
  enabled: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="Gestão Inteligente de Horários"
      disabled={busy}
      onClick={onToggle}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 min-touch",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        enabled ? "bg-success" : "bg-muted-foreground/35",
      )}
    >
      <span
        className={cn(
          "pointer-events-none absolute top-0.5 left-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-card shadow-[var(--shadow-elevation-1)] transition-transform duration-200",
          enabled && "translate-x-5",
        )}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />
        ) : null}
      </span>
    </button>
  );
}

function formatSlotWhen(iso: string): string {
  return DateTime.fromISO(iso, { zone: "utc" })
    .setZone(DEFAULT_SCHEDULE_TIMEZONE)
    .setLocale("pt-BR")
    .toFormat("ccc dd/LL · HH:mm");
}

function slotStatusLabel(slot: YieldMarketplaceSlotRow): string {
  if (slot.status === "BOOKED") return "Reservado (paciente)";
  if (slot.yieldActive) return "Em oferta (opt-in)";
  return "Ofertado (aguardando destaque)";
}

type WindowDraft = {
  label: string;
  recurrence: "WEEKLY" | "ONCE";
  weekdays: number[];
  startTime: string;
  endTime: string;
  specificDate: string;
};

const EMPTY_DRAFT: WindowDraft = {
  label: "",
  recurrence: "WEEKLY",
  weekdays: [1, 2, 3, 4, 5],
  startTime: "08:00",
  endTime: "18:00",
  specificDate: "",
};

type Props = {
  initial: YieldDashboardData;
};

export function YieldScheduleConfigCard({ initial }: Props) {
  const seedConfig = initial.config ?? DEFAULT_YIELD_CONFIG;
  const [enabled, setEnabled] = useState(seedConfig.enabled);
  const [hoursBeforeTrigger, setHoursBeforeTrigger] = useState(
    String(seedConfig.hoursBeforeTrigger),
  );
  const [discountPercentage, setDiscountPercentage] = useState(
    String(seedConfig.discountPercentage),
  );
  const [windows, setWindows] = useState<YieldOfferWindowData[]>(initial.windows);
  const [slots, setSlots] = useState<YieldMarketplaceSlotRow[]>(initial.slots);
  const [draft, setDraft] = useState<WindowDraft>(EMPTY_DRAFT);
  const [isPending, startTransition] = useTransition();
  const [windowPending, startWindowTransition] = useTransition();
  const [slotPendingId, setSlotPendingId] = useState<string | null>(null);

  const offeredCount = useMemo(
    () => slots.filter((s) => s.status === "AVAILABLE").length,
    [slots],
  );
  const yieldActiveCount = useMemo(
    () => slots.filter((s) => s.yieldActive && s.status === "AVAILABLE").length,
    [slots],
  );

  async function refreshDashboard() {
    const dash = await getYieldDashboard();
    if (dash.success) {
      setWindows(dash.data.windows);
      setSlots(dash.data.slots);
      setEnabled(dash.data.config.enabled);
      setHoursBeforeTrigger(String(dash.data.config.hoursBeforeTrigger));
      setDiscountPercentage(String(dash.data.config.discountPercentage));
    }
  }

  function persistConfig(next: {
    enabled: boolean;
    hoursBeforeTrigger: number;
    discountPercentage: number;
  }) {
    startTransition(async () => {
      const result = await saveYieldConfig(next);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setEnabled(result.data.enabled);
      setHoursBeforeTrigger(String(result.data.hoursBeforeTrigger));
      setDiscountPercentage(String(result.data.discountPercentage));
      await refreshDashboard();
      toast.success(
        result.data.enabled
          ? "Gestão Inteligente ativada. Grade sincronizada com o marketplace."
          : "Gestão Inteligente desativada.",
      );
    });
  }

  function handleToggle() {
    const hours = Number(hoursBeforeTrigger);
    const discount = Number(discountPercentage);
    persistConfig({
      enabled: !enabled,
      hoursBeforeTrigger: Number.isFinite(hours) ? hours : seedConfig.hoursBeforeTrigger,
      discountPercentage: Number.isFinite(discount)
        ? discount
        : seedConfig.discountPercentage,
    });
  }

  function handleSubmitRule(event: React.FormEvent) {
    event.preventDefault();
    persistConfig({
      enabled,
      hoursBeforeTrigger: Number(hoursBeforeTrigger),
      discountPercentage: Number(discountPercentage),
    });
  }

  function toggleWeekday(day: number) {
    setDraft((prev) => {
      const has = prev.weekdays.includes(day);
      return {
        ...prev,
        weekdays: has
          ? prev.weekdays.filter((d) => d !== day)
          : [...prev.weekdays, day].sort((a, b) => a - b),
      };
    });
  }

  function handleAddWindow(event: React.FormEvent) {
    event.preventDefault();
    const startMinute = timeLabelToMinutes(draft.startTime);
    const endMinute = timeLabelToMinutes(draft.endTime);
    if (startMinute == null || endMinute == null) {
      toast.error("Informe horários no formato HH:mm.");
      return;
    }

    startWindowTransition(async () => {
      const result = await saveYieldOfferWindow({
        label: draft.label || null,
        recurrence: draft.recurrence,
        weekdays: draft.recurrence === "WEEKLY" ? draft.weekdays : [],
        startMinute,
        endMinute,
        specificDate: draft.recurrence === "ONCE" ? draft.specificDate || null : null,
        isActive: true,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      await refreshDashboard();
      setDraft(EMPTY_DRAFT);
      toast.success("Janela de horários salva. Ofertas regeneradas no marketplace.");
    });
  }

  function handleDeleteWindow(id: string) {
    startWindowTransition(async () => {
      const result = await deleteYieldOfferWindow({ id });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      await refreshDashboard();
      toast.success("Janela removida.");
    });
  }

  function handleWithdrawSlot(slotId: string) {
    setSlotPendingId(slotId);
    startTransition(async () => {
      const result = await withdrawMarketplaceSlot({ slotId });
      setSlotPendingId(null);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setSlots((prev) => prev.filter((s) => s.id !== slotId));
      toast.success("Horário retirado do marketplace.");
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="clinical-grouped bg-card">
        <CardHeader className="gap-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2 text-foreground">
                <Zap className="h-5 w-5 shrink-0 text-success" aria-hidden />
                Gestão Inteligente de Horários
              </CardTitle>
              <CardDescription>
                Só entram horários que você marcar com desconto na Agenda ou por
                comando de voz. Cadastro, sync ou marcação interna não colocam
                nada aqui automaticamente.
              </CardDescription>
            </div>
            <YieldToggle enabled={enabled} busy={isPending} onToggle={handleToggle} />
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmitRule} className="space-y-5">
            <p className="text-sm leading-relaxed text-foreground">
              Aplicar desconto de{" "}
              <label className="sr-only" htmlFor="yield-discount">
                Percentual de desconto
              </label>
              <Input
                id="yield-discount"
                type="number"
                inputMode="decimal"
                min={1}
                max={90}
                step={1}
                disabled={isPending || !enabled}
                value={discountPercentage}
                onChange={(event) => setDiscountPercentage(event.target.value)}
                className="mx-1 inline-flex h-11 w-20 min-touch text-center md:text-base"
              />
              % se o horário estiver vago faltando{" "}
              <label className="sr-only" htmlFor="yield-hours">
                Horas antes do horário
              </label>
              <Input
                id="yield-hours"
                type="number"
                inputMode="numeric"
                min={1}
                max={168}
                step={1}
                disabled={isPending || !enabled}
                value={hoursBeforeTrigger}
                onChange={(event) => setHoursBeforeTrigger(event.target.value)}
                className="mx-1 inline-flex h-11 w-20 min-touch text-center md:text-base"
              />{" "}
              horas.
            </p>
            <div className="rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
              O percentual acima vale quando você ofertar um horário (agenda ou
              voz). Nenhum horário entra sozinho na lista do marketplace.
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button
                type="submit"
                disabled={isPending || !enabled}
                className="min-h-[2.75rem] w-full sm:w-auto"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : null}
                Salvar regra
              </Button>
              <Label className="text-xs text-muted-foreground sm:ml-1">
                {enabled
                  ? `${offeredCount} horário(s) ofertado(s) · ${yieldActiveCount} com desconto ativo.`
                  : "Ative a chave e oferte horários pela Agenda ou por voz."}
              </Label>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="clinical-grouped bg-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-5 w-5 text-primary" aria-hidden />
            Dias e horários elegíveis
          </CardTitle>
          <CardDescription>
            Preferências de dias/faixas para organizar ofertar em lote no futuro.
            Não geram horários sozinhas — cada oferta continua opt-in.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {windows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              Nenhuma janela salva. Opcional — use só como lembrete de quais
              faixas você costuma ofertar.
            </p>
          ) : (
            <ul className="space-y-2">
              {windows.map((window) => (
                <li
                  key={window.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-3"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium text-foreground">
                      {window.label ||
                        (window.recurrence === "WEEKLY" ? "Semanal" : "Pontual")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {window.recurrence === "WEEKLY"
                        ? formatWeekdaysLabel(window.weekdays)
                        : window.specificDate
                          ? DateTime.fromISO(window.specificDate)
                              .setLocale("pt-BR")
                              .toFormat("dd/LL/yyyy")
                          : "—"}{" "}
                      · {minutesToTimeLabel(window.startMinute)}–
                      {minutesToTimeLabel(window.endMinute)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="min-touch shrink-0 text-muted-foreground hover:text-destructive"
                    disabled={windowPending}
                    aria-label="Remover janela"
                    onClick={() => handleDeleteWindow(window.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <form
            onSubmit={handleAddWindow}
            className="space-y-4 rounded-lg border border-border p-3"
          >
            <p className="text-sm font-medium text-foreground">Nova janela</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={draft.recurrence === "WEEKLY" ? "default" : "outline"}
                className="min-h-[2.75rem]"
                onClick={() => setDraft((p) => ({ ...p, recurrence: "WEEKLY" }))}
              >
                Semanal (rotativo)
              </Button>
              <Button
                type="button"
                variant={draft.recurrence === "ONCE" ? "default" : "outline"}
                className="min-h-[2.75rem]"
                onClick={() => setDraft((p) => ({ ...p, recurrence: "ONCE" }))}
              >
                Pontual (fixo)
              </Button>
            </div>

            {draft.recurrence === "WEEKLY" ? (
              <div className="flex flex-wrap gap-2">
                {WEEKDAY_OPTIONS.map((day) => {
                  const active = draft.weekdays.includes(day.value);
                  return (
                    <button
                      key={day.value}
                      type="button"
                      onClick={() => toggleWeekday(day.value)}
                      className={cn(
                        "min-h-[2.75rem] min-w-[2.75rem] rounded-md border px-2 text-sm font-medium transition-colors",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="yield-once-date">Data</Label>
                <Input
                  id="yield-once-date"
                  type="date"
                  value={draft.specificDate}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, specificDate: e.target.value }))
                  }
                  className="min-h-[2.75rem]"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="yield-start">Das</Label>
                <Input
                  id="yield-start"
                  type="time"
                  value={draft.startTime}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, startTime: e.target.value }))
                  }
                  className="min-h-[2.75rem]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="yield-end">Até</Label>
                <Input
                  id="yield-end"
                  type="time"
                  value={draft.endTime}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, endTime: e.target.value }))
                  }
                  className="min-h-[2.75rem]"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="yield-window-label">Nome (opcional)</Label>
              <Input
                id="yield-window-label"
                value={draft.label}
                placeholder="Ex.: Tarde de pilates"
                onChange={(e) => setDraft((p) => ({ ...p, label: e.target.value }))}
                className="min-h-[2.75rem]"
                maxLength={80}
              />
            </div>

            <Button
              type="submit"
              disabled={windowPending || !enabled}
              className="min-h-[2.75rem] w-full sm:w-auto"
            >
              {windowPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Plus className="h-4 w-4" aria-hidden />
              )}
              Adicionar janela
            </Button>
            {!enabled ? (
              <p className="text-xs text-muted-foreground">
                Ative a Gestão Inteligente para gravar preferências de janela.
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <Card className="clinical-grouped bg-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Percent className="h-5 w-5 text-clinical" aria-hidden />
            Horários no marketplace
          </CardTitle>
          <CardDescription>
            Lista ao vivo só do que você optou por ofertar. Na{" "}
            <Link
              href="/dashboard/agenda"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              Agenda
            </Link>
            , toque no horário vazio → «Ofertar com desconto», ou use o comando
            de voz.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {slots.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              Nenhum horário ofertado. Escolha um a um na Agenda ou por áudio —
              nada entra automaticamente.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {slots.map((slot) => (
                <li
                  key={slot.id}
                  className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium text-foreground">
                      {formatSlotWhen(slot.startAt)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {slotStatusLabel(slot)}
                      {slot.yieldActive && slot.discountPrice != null
                        ? ` · R$ ${slot.discountPrice.toFixed(2).replace(".", ",")} (de R$ ${slot.basePrice.toFixed(2).replace(".", ",")})`
                        : ` · R$ ${slot.basePrice.toFixed(2).replace(".", ",")}`}
                      {slot.patientName ? ` · ${slot.patientName}` : null}
                    </p>
                  </div>
                  {slot.status === "AVAILABLE" ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-[2.75rem] shrink-0"
                      disabled={slotPendingId === slot.id || isPending}
                      onClick={() => handleWithdrawSlot(slot.id)}
                    >
                      {slotPendingId === slot.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : null}
                      Retirar oferta
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Mantém compatibilidade com import antigo que só recebia config.
export type { YieldConfigData };
