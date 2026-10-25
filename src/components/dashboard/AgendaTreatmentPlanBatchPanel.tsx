"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DateTime } from "luxon";
import { CalendarRange, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  generateTreatmentPlanAppointments,
  listTreatmentPlanBatchCandidates,
} from "@/app/actions/appointment";
import { formatBrlFromCents } from "@/components/dashboard/finances/finance-format";
import { DEFAULT_SCHEDULE_TIMEZONE } from "@/lib/schedule-temporal-parse";
import type { TreatmentPlanBatchCandidate } from "@/lib/appointment-treatment-plan-batch";
import { cn } from "@/lib/utils";

type PatientOption = { id: string; name: string };

type Props = {
  patients: PatientOption[];
  timezone?: string;
  outlineBtnClass?: string;
  onGenerated: () => void | Promise<void>;
};

function toDateInputValue(dt: DateTime): string {
  return dt.toFormat("yyyy-LL-dd");
}

function combineDateTime(dateValue: string, timeValue: string, tz: string): Date {
  return DateTime.fromFormat(`${dateValue} ${timeValue}`, "yyyy-LL-dd HH:mm", { zone: tz })
    .toUTC()
    .toJSDate();
}

export function AgendaTreatmentPlanBatchPanel({
  patients,
  timezone = DEFAULT_SCHEDULE_TIMEZONE,
  outlineBtnClass,
  onGenerated,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [patientFilter, setPatientFilter] = useState("");
  const [candidates, setCandidates] = useState<TreatmentPlanBatchCandidate[]>([]);
  const [selectedPurchaseId, setSelectedPurchaseId] = useState("");
  const [dateValue, setDateValue] = useState(toDateInputValue(DateTime.now().setZone(timezone)));
  const [timeValue, setTimeValue] = useState("09:00");
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [intervalDays, setIntervalDays] = useState("7");

  const selected = useMemo(
    () => candidates.find((c) => c.purchaseId === selectedPurchaseId) ?? null,
    [candidates, selectedPurchaseId],
  );

  async function loadCandidates(filterPatientId?: string) {
    setLoading(true);
    try {
      const res = await listTreatmentPlanBatchCandidates(
        filterPatientId?.trim() ? filterPatientId : undefined,
      );
      if (!res.success) {
        toast.error(res.error);
        setCandidates([]);
        setSelectedPurchaseId("");
        return;
      }
      const rows = res.data ?? [];
      setCandidates(rows);
      setSelectedPurchaseId((prev) =>
        rows.some((r) => r.purchaseId === prev) ? prev : (rows[0]?.purchaseId ?? ""),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCandidates(patientFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientFilter]);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) {
      toast.error("Selecione um pacote de serviço do financeiro.");
      return;
    }

    const minutes = Number(durationMinutes);
    const interval = Number(intervalDays);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      toast.error("Duração inválida.");
      return;
    }
    if (!Number.isFinite(interval) || interval < 1) {
      toast.error("Intervalo inválido.");
      return;
    }

    const firstStartAt = combineDateTime(dateValue, timeValue, timezone);

    setSubmitting(true);
    try {
      const res = await generateTreatmentPlanAppointments({
        purchaseId: selected.purchaseId,
        firstStartAt,
        durationMinutes: minutes,
        intervalDays: interval,
        timezoneAtBooking: timezone,
        careSetting: "IN_PERSON_CLINIC",
      });

      if (!res.success) {
        toast.error(res.error);
        return;
      }

      const count = res.data?.createdCount ?? 0;
      toast.success(
        count === 1
          ? "1 marcação criada a partir do pacote de serviço."
          : `${count} marcações criadas a partir do pacote de serviço.`,
      );
      await loadCandidates(patientFilter);
      await onGenerated();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarRange className="h-4 w-4 shrink-0" />
          Gerar horários de pacote de serviço
        </CardTitle>
        <CardDescription>
          Liga cada sessão pendente do{" "}
          <Link href="/dashboard/finances" className="underline underline-offset-2">
            financeiro
          </Link>{" "}
          a um horário na agenda (cobrança por sessão de pacote, valor proporcional por sessão).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando planos com sessões pendentes…
          </div>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum pacote de serviço com sessões pendentes sem marcação. Registe uma venda de pacote
            no{" "}
            <Link href="/dashboard/finances" className="underline underline-offset-2">
              financeiro
            </Link>{" "}
            primeiro.
            <span className="mt-2 block text-xs">
              Serviços avulsos e retornos com valor na agenda entram no caixa ao marcar realizada —
              não usam este painel.
            </span>
          </p>
        ) : (
          <form onSubmit={(e) => void handleGenerate(e)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="batch-patient-filter">Filtrar paciente (opcional)</Label>
              <select
                id="batch-patient-filter"
                value={patientFilter}
                onChange={(e) => setPatientFilter(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="">Todos com plano pendente</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="batch-purchase">Tratamento/plano (financeiro)</Label>
              <select
                id="batch-purchase"
                value={selectedPurchaseId}
                onChange={(e) => setSelectedPurchaseId(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                required
              >
                {candidates.map((c) => (
                  <option key={c.purchaseId} value={c.purchaseId}>
                    {c.patientName} — {c.serviceName} ({c.schedulableCount} sessão
                    {c.schedulableCount === 1 ? "" : "ões"} ·{" "}
                    {formatBrlFromCents(c.schedulableValueCents)})
                  </option>
                ))}
              </select>
            </div>

            {selected && (
              <p className="text-xs text-muted-foreground rounded-md border border-border p-2">
                Pacote de {selected.sessionCountTotal} sessões ·{" "}
                {selected.schedulableCount} ainda sem horário · valor pendente{" "}
                {formatBrlFromCents(selected.schedulableValueCents)}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="batch-date">Primeira data</Label>
                <Input
                  id="batch-date"
                  type="date"
                  value={dateValue}
                  onChange={(e) => setDateValue(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="batch-time">Horário</Label>
                <Input
                  id="batch-time"
                  type="time"
                  value={timeValue}
                  onChange={(e) => setTimeValue(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="batch-duration">Duração (min)</Label>
                <Input
                  id="batch-duration"
                  type="number"
                  min={15}
                  step={15}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="batch-interval">Intervalo (dias)</Label>
                <Input
                  id="batch-interval"
                  type="number"
                  min={1}
                  max={90}
                  value={intervalDays}
                  onChange={(e) => setIntervalDays(e.target.value)}
                />
              </div>
            </div>

            {selected && (
              <p className="text-xs text-muted-foreground">
                Serão criadas {selected.schedulableCount} marcações, uma a cada {intervalDays} dia(s),
                começando em {dateValue} às {timeValue}. Cada uma fica amarela (falta confirmar) até
                você confirmar no card.
              </p>
            )}

            <Button
              type="submit"
              className="w-full bg-primary hover:bg-primary/90 text-white"
              disabled={submitting || !selected}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Gerando…
                </>
              ) : (
                `Gerar ${selected?.schedulableCount ?? 0} marcação(ões)`
              )}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
