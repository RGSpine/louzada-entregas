"use client";

import { useEffect, useState } from "react";
import { DateTime } from "luxon";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { generateAppointmentSeries, updateAppointment } from "@/app/actions/appointment";
import { DEFAULT_SCHEDULE_TIMEZONE } from "@/lib/schedule-temporal-parse";
import { ClinicalCalmModal } from "@/components/ui/ClinicalCalmModal";
import { AGENDA_MODAL_Z_INDEX_CLASS } from "@/components/dashboard/agenda/AgendaToolsToolbar";
import { AgendaAppointmentQuickActions } from "@/components/dashboard/agenda/AgendaAppointmentQuickActions";
import type { AgendaCalendarAppointment } from "@/lib/agenda/schedule-x-mappers";
import { cn } from "@/lib/utils";
import {
  AgendaRecurrenceFields,
  type AgendaRecurrenceFormState,
} from "@/components/dashboard/agenda/AgendaRecurrenceFields";
import {
  AgendaAppointmentMetaFields,
  formatCentsToPriceReais,
  parsePriceReaisToCents,
  type AppointmentMetaFormState,
} from "@/components/dashboard/AgendaAppointmentMetaFields";
import { shiftTimeValue, snapTimeValue } from "@/lib/agenda/agenda-time-edit";
import { AgendaPatientSearchSelect } from "@/components/dashboard/agenda/AgendaPatientSearchSelect";

export type AgendaEditAppointmentTarget = AgendaCalendarAppointment;

type PatientOption = { id: string; name: string };

type Props = {
  open: boolean;
  appointment: AgendaEditAppointmentTarget | null;
  patients: PatientOption[];
  outlineBtnClass?: string;
  canUseConfirmationColors: boolean;
  statusUpdatingId: string | null;
  onStatusChangeStart: (id: string) => void;
  onStatusChangeEnd: () => void;
  onChanged: () => void | Promise<void>;
  onClose: () => void;
  onSaved: (startAt?: Date) => void;
};

const TZ = DEFAULT_SCHEDULE_TIMEZONE;
const EDIT_FORM_ID = "agenda-edit-appointment-form";

const DEFAULT_META: AppointmentMetaFormState = {
  visitKind: "UNIQUE_CONSULTATION",
  careSetting: "IN_PERSON_CLINIC",
  notes: "",
  priceReais: "",
  patientServiceSessionId: "",
  professionalServiceId: "",
  serviceSpaceId: "",
};

function toDateInputValue(dt: DateTime): string {
  return dt.toFormat("yyyy-LL-dd");
}

function combineDateTime(dateValue: string, timeValue: string): Date {
  return DateTime.fromFormat(`${dateValue} ${timeValue}`, "yyyy-LL-dd HH:mm", { zone: TZ }).toUTC().toJSDate();
}

export function AgendaEditAppointmentModal({
  open,
  appointment,
  patients,
  outlineBtnClass,
  canUseConfirmationColors,
  statusUpdatingId,
  onStatusChangeStart,
  onStatusChangeEnd,
  onChanged,
  onClose,
  onSaved,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [linkMode, setLinkMode] = useState<"rename" | "existing">("rename");
  const [patientId, setPatientId] = useState("");
  const [patientName, setPatientName] = useState("");
  const [dateValue, setDateValue] = useState("");
  const [timeValue, setTimeValue] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [meta, setMeta] = useState<AppointmentMetaFormState>(DEFAULT_META);
  const [recurrence, setRecurrence] = useState<AgendaRecurrenceFormState>({
    enabled: true,
    sessionCount: "10",
    weekdays: [1, 3, 5],
  });
  const [generatingSeries, setGeneratingSeries] = useState(false);

  useEffect(() => {
    if (!open || !appointment) return;
    const startLocal = DateTime.fromJSDate(appointment.startAt, { zone: "utc" }).setZone(TZ);
    const endLocal = DateTime.fromJSDate(appointment.endAt, { zone: "utc" }).setZone(TZ);
    const duration = Math.max(15, Math.round(endLocal.diff(startLocal, "minutes").minutes));

    setLinkMode("rename");
    setPatientId(appointment.patientId);
    setPatientName(appointment.patientName);
    setDateValue(toDateInputValue(startLocal));
    setTimeValue(startLocal.toFormat("HH:mm"));
    setDurationMinutes(String(duration));
    setRecurrence({
      enabled: true,
      sessionCount: "10",
      weekdays: [startLocal.weekday],
    });
    setMeta({
      visitKind: appointment.visitKind,
      careSetting: appointment.careSetting,
      notes: appointment.notes ?? "",
      priceReais: formatCentsToPriceReais(appointment.priceCents),
      patientServiceSessionId: appointment.patientServiceSessionId ?? "",
      professionalServiceId: appointment.professionalServiceId ?? "",
      serviceSpaceId: appointment.serviceSpaceId ?? "",
    });
  }, [open, appointment]);

  if (!appointment) return null;

  const effectivePatientId = linkMode === "existing" ? patientId : appointment.patientId;
  const canSave = !saving && !generatingSeries && !(linkMode === "rename" && patientName.trim().length < 2);
  const inSeries = Boolean(appointment.recurrenceSeriesId);
  const canGenerateSeries = appointment.status === "SCHEDULED" && !inSeries;

  async function handleGenerateSeries() {
    if (!appointment) return;
    const minutes = Number(durationMinutes);
    const count = Number(recurrence.sessionCount);
    if (!Number.isFinite(minutes) || minutes < 15) {
      toast.error("Duração inválida.");
      return;
    }
    if (!Number.isFinite(count) || count < 2) {
      toast.error("Informe pelo menos 2 sessões para gerar a série.");
      return;
    }
    if (recurrence.weekdays.length === 0) {
      toast.error("Selecione pelo menos um dia da semana.");
      return;
    }

    const startUtc = combineDateTime(dateValue, timeValue);
    setGeneratingSeries(true);
    try {
      const result = await generateAppointmentSeries({
        appointmentId: appointment.id,
        sessionCount: count,
        weekdays: recurrence.weekdays,
        durationMinutes: minutes,
        startAt: startUtc,
        timezoneAtBooking: TZ,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      const created = result.data?.createdCount ?? 0;
      const total = result.data?.totalCount ?? count;
      toast.success(
        created > 0
          ? `Série fixa gerada: ${total} sessões (${created} novas).`
          : "Série atualizada.",
      );
      await onChanged();
      onSaved(startUtc);
      onClose();
    } finally {
      setGeneratingSeries(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!appointment) return;

    const minutes = Number(durationMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      toast.error("Duração inválida.");
      return;
    }

    const startUtc = combineDateTime(dateValue, timeValue);
    const endUtc = DateTime.fromJSDate(startUtc, { zone: "utc" }).plus({ minutes }).toJSDate();
    const priceCents = parsePriceReaisToCents(meta.priceReais);

    setSaving(true);
    try {
      const result = await updateAppointment({
        appointmentId: appointment.id,
        ...(linkMode === "existing"
          ? { patientId }
          : { patientId: appointment.patientId, newPatientName: patientName.trim() }),
        startAt: startUtc,
        endAt: endUtc,
        timezoneAtBooking: TZ,
        visitKind: meta.visitKind,
        careSetting: meta.careSetting,
        notes: meta.notes.trim() || null,
        priceCents,
        professionalServiceId: meta.professionalServiceId.trim() || null,
        serviceSpaceId: meta.serviceSpaceId.trim() || null,
        patientServiceSessionId:
          meta.visitKind === "TREATMENT_PLAN" && meta.patientServiceSessionId
            ? meta.patientServiceSessionId
            : null,
      });

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success("Marcação atualizada.");
      onSaved(startUtc);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <ClinicalCalmModal
      open={open}
      onClose={onClose}
      labelledBy="edit-appointment-title"
      className="flex max-h-[90vh] max-w-md flex-col overflow-hidden p-0"
      zIndexClass={AGENDA_MODAL_Z_INDEX_CLASS}
    >
      <div className="sticky top-0 z-10 shrink-0 border-b border-border bg-card px-5 pb-3 pt-5 shadow-[var(--shadow-elevation-1)]">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0 pr-2">
            <h2 id="edit-appointment-title" className="text-lg font-semibold">
              Marcação
            </h2>
            <p className="text-sm text-muted-foreground">
              Confirme, realize ou edite dados da marcação.
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose}>
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className={cn("flex-1", outlineBtnClass)}
            onClick={onClose}
            disabled={saving || generatingSeries}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            form={EDIT_FORM_ID}
            className="flex-1"
            disabled={!canSave}
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Salvando…
              </>
            ) : (
              "Salvar"
            )}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-4">
        <form id={EDIT_FORM_ID} onSubmit={(e) => void handleSave(e)} className="space-y-4">
          <div className="space-y-3 rounded-md border border-border/80 bg-muted/30 p-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Horário da marcação</p>
              <p className="text-[11px] leading-snug text-muted-foreground">
                Altere data e hora aqui, ou arraste o card na grade (segure um instante e mova).
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-date">Data</Label>
                <Input
                  id="edit-date"
                  type="date"
                  value={dateValue}
                  onChange={(e) => setDateValue(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-time">Horário</Label>
                <Input
                  id="edit-time"
                  type="time"
                  step={300}
                  value={timeValue}
                  onChange={(e) => setTimeValue(e.target.value)}
                  onBlur={() => setTimeValue(snapTimeValue(timeValue, 5))}
                  required
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={cn("h-8 text-xs", outlineBtnClass)}
                onClick={() => setTimeValue(shiftTimeValue(timeValue, -15))}
              >
                −15 min
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={cn("h-8 text-xs", outlineBtnClass)}
                onClick={() => setTimeValue(shiftTimeValue(timeValue, -5))}
              >
                −5 min
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={cn("h-8 text-xs", outlineBtnClass)}
                onClick={() => setTimeValue(snapTimeValue(timeValue, 15))}
              >
                :00/:15/:30/:45
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={cn("h-8 text-xs", outlineBtnClass)}
                onClick={() => setTimeValue(shiftTimeValue(timeValue, 5))}
              >
                +5 min
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={cn("h-8 text-xs", outlineBtnClass)}
                onClick={() => setTimeValue(shiftTimeValue(timeValue, 15))}
              >
                +15 min
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-duration-top">Duração (min)</Label>
              <Input
                id="edit-duration-top"
                type="number"
                min={15}
                step={5}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                className="max-w-[8rem]"
              />
            </div>
          </div>

          <AgendaAppointmentQuickActions
            item={appointment}
            canUseConfirmationColors={canUseConfirmationColors}
            statusUpdatingId={statusUpdatingId}
            onStatusChangeStart={onStatusChangeStart}
            onStatusChangeEnd={onStatusChangeEnd}
            onChanged={onChanged}
            onDeleted={onClose}
          />

          <div className="border-t border-border" />

          <h3 className="text-sm font-semibold">Editar dados</h3>

          <div className="space-y-2">
            <Label>Paciente</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={linkMode === "rename" ? "default" : "outline"}
                size="sm"
                className={cn(linkMode === "rename" ? undefined : outlineBtnClass)}
                onClick={() => setLinkMode("rename")}
              >
                Corrigir nome
              </Button>
              <Button
                type="button"
                variant={linkMode === "existing" ? "default" : "outline"}
                size="sm"
                className={cn(linkMode === "existing" ? undefined : outlineBtnClass)}
                onClick={() => setLinkMode("existing")}
              >
                Outro cadastrado
              </Button>
            </div>
            {linkMode === "rename" ? (
              <Input
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                maxLength={200}
                placeholder="Nome no agendamento"
              />
            ) : (
              <AgendaPatientSearchSelect
                patients={patients}
                value={patientId}
                onChange={setPatientId}
                placeholder="Digite o nome para buscar…"
              />
            )}
          </div>

          <AgendaAppointmentMetaFields
            state={meta}
            onChange={(patch) => setMeta((prev) => ({ ...prev, ...patch }))}
            patientId={effectivePatientId}
            appointmentId={appointment.id}
            syncActivePlan={linkMode === "existing" && patientId !== appointment.patientId}
          />

          <AgendaRecurrenceFields
            durationMinutes={durationMinutes}
            onDurationMinutesChange={setDurationMinutes}
            recurrence={recurrence}
            onRecurrenceChange={(patch) => setRecurrence((prev) => ({ ...prev, ...patch }))}
            outlineBtnClass={outlineBtnClass}
            showSeriesControls={canGenerateSeries}
            seriesTitle="Fixar repetição"
            seriesDescription="Gera as próximas sessões no mesmo horário, nos dias escolhidos. Esta marcação conta como a primeira."
          />

          {canGenerateSeries && recurrence.enabled ? (
            <Button
              type="button"
              className="w-full"
              disabled={generatingSeries || saving}
              onClick={() => void handleGenerateSeries()}
            >
              {generatingSeries ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Gerando série…
                </>
              ) : (
                "Gerar série"
              )}
            </Button>
          ) : null}

          {inSeries ? (
            <p className="text-[11px] leading-snug text-muted-foreground">
              Esta marcação já faz parte de uma série fixa.
            </p>
          ) : null}
        </form>
      </div>
    </ClinicalCalmModal>
  );
}
