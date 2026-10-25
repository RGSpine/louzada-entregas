"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { listPendingTreatmentPlanSessions } from "@/app/actions/appointment";
import { listProfessionalServices } from "@/app/actions/clinic-finances";
import {
  CARE_SETTING_LABELS,
  CARE_SETTING_NOTES_PLACEHOLDER,
} from "@/lib/appointment-visit-meta";
import { SERVICE_BILLING_LABELS } from "@/lib/appointment-service-meta";
import type {
  AppointmentCareSettingValue,
  AppointmentVisitKindValue,
} from "@/lib/appointment-fields-schema";
import { ServiceSpaceSelect } from "@/components/dashboard/finances/ServiceSpaceSelect";

export type AppointmentMetaFormState = {
  visitKind: AppointmentVisitKindValue;
  careSetting: AppointmentCareSettingValue;
  notes: string;
  /** Valor em reais para exibição (ex.: "150,00"). Vazio = sem valor explícito. */
  priceReais: string;
  patientServiceSessionId: string;
  /** Serviço do catálogo (ProfessionalService). */
  professionalServiceId: string;
  /** Espaço de Serviços (Consultório/Clínica). Vazio = geral. */
  serviceSpaceId: string;
};

type CatalogService = {
  id: string;
  name: string;
  defaultPriceCents: number;
  serviceSpaceId: string | null;
};

type PendingSession = {
  id: string;
  sequence: number;
  totalSessions: number;
  serviceName: string;
  professionalServiceId: string;
  allocatedPriceCents: number;
  serviceSpaceId: string | null;
};

type Props = {
  state: AppointmentMetaFormState;
  onChange: (patch: Partial<AppointmentMetaFormState>) => void;
  patientId: string;
  appointmentId?: string;
  /**
   * Na criação (ou ao trocar paciente na edição), preenche plano/cobrança/sessão
   * automaticamente a partir do pacote pendente do paciente cadastrado.
   * Default: true quando não há appointmentId.
   */
  syncActivePlan?: boolean;
};

const BILLING_OPTIONS = Object.entries(SERVICE_BILLING_LABELS) as Array<
  [AppointmentVisitKindValue, string]
>;
const CARE_SETTING_OPTIONS = Object.entries(CARE_SETTING_LABELS) as Array<
  [AppointmentCareSettingValue, string]
>;

export function parsePriceReaisToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\./g, "").replace(",", ".");
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100);
}

export function formatCentsToPriceReais(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function AgendaAppointmentMetaFields({
  state,
  onChange,
  patientId,
  appointmentId,
  syncActivePlan = !appointmentId,
}: Props) {
  const [services, setServices] = useState<CatalogService[]>([]);
  const [loadingServices, setLoadingServices] = useState(true);
  const [sessions, setSessions] = useState<PendingSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingServices(true);
    void listProfessionalServices().then((res) => {
      if (cancelled) return;
      setLoadingServices(false);
      if (res.success && res.data) {
        setServices(
          res.data.filter((s) => s.active).map((s) => ({
            id: s.id,
            name: s.name,
            defaultPriceCents: s.defaultPriceCents,
            serviceSpaceId: s.serviceSpaceId,
          })),
        );
      } else {
        setServices([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!patientId) {
      setSessions([]);
      setLoadingSessions(false);
      // Paciente novo / sem ficha: não herdar plano de outro paciente.
      if (syncActivePlan) {
        onChange({
          visitKind: "UNIQUE_CONSULTATION",
          patientServiceSessionId: "",
        });
      }
      return;
    }

    let cancelled = false;
    setLoadingSessions(true);
    void listPendingTreatmentPlanSessions(patientId, appointmentId).then((res) => {
      if (cancelled) return;
      setLoadingSessions(false);
      const pending = res.success && res.data ? res.data : [];
      setSessions(pending);

      if (!syncActivePlan) {
        // Edição sem troca de paciente: só corrige sessão inválida se já for pacote.
        if (state.visitKind !== "TREATMENT_PLAN") return;
        const linkedOk = pending.some((s) => s.id === state.patientServiceSessionId);
        if (linkedOk || pending.length === 0) return;
        const first = pending[0]!;
        onChange({
          patientServiceSessionId: first.id,
          professionalServiceId: first.professionalServiceId,
          priceReais: formatCentsToPriceReais(first.allocatedPriceCents),
          ...(first.serviceSpaceId ? { serviceSpaceId: first.serviceSpaceId } : {}),
        });
        return;
      }

      // Criação / troca de paciente cadastrado: preenche plano ativo automaticamente.
      if (pending.length === 0) {
        onChange({
          visitKind: "UNIQUE_CONSULTATION",
          patientServiceSessionId: "",
        });
        return;
      }

      const first = pending[0]!;
      onChange({
        visitKind: "TREATMENT_PLAN",
        patientServiceSessionId: first.id,
        professionalServiceId: first.professionalServiceId,
        priceReais: formatCentsToPriceReais(first.allocatedPriceCents),
        ...(first.serviceSpaceId ? { serviceSpaceId: first.serviceSpaceId } : {}),
      });
    });

    return () => {
      cancelled = true;
    };
    // Intencional: reagir só à troca de paciente/marcação (não a cada tecla do formulário).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, appointmentId, syncActivePlan]);

  const notesPlaceholder = CARE_SETTING_NOTES_PLACEHOLDER[state.careSetting];

  const selectedPendingSession =
    sessions.find((s) => s.id === state.patientServiceSessionId) ?? sessions[0] ?? null;

  const filteredServices = state.serviceSpaceId
    ? services.filter(
        (s) => s.serviceSpaceId === state.serviceSpaceId || s.serviceSpaceId == null,
      )
    : services;

  function handleSpaceChange(spaceId: string) {
    const selected = services.find((s) => s.id === state.professionalServiceId);
    const stillValid =
      !selected ||
      !spaceId ||
      selected.serviceSpaceId == null ||
      selected.serviceSpaceId === spaceId;
    onChange({
      serviceSpaceId: spaceId,
      ...(!stillValid ? { professionalServiceId: "" } : {}),
    });
  }

  function handleServiceChange(serviceId: string) {
    const service = services.find((s) => s.id === serviceId);
    onChange({
      professionalServiceId: serviceId,
      ...(service?.serviceSpaceId
        ? { serviceSpaceId: service.serviceSpaceId }
        : {}),
      ...(service && service.defaultPriceCents > 0
        ? { priceReais: formatCentsToPriceReais(service.defaultPriceCents) }
        : {}),
    });
  }

  function handleSessionChange(sessionId: string) {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) {
      onChange({ patientServiceSessionId: sessionId });
      return;
    }
    onChange({
      patientServiceSessionId: sessionId,
      professionalServiceId: session.professionalServiceId,
      priceReais: formatCentsToPriceReais(session.allocatedPriceCents),
      ...(session.serviceSpaceId
        ? { serviceSpaceId: session.serviceSpaceId }
        : {}),
    });
  }

  return (
    <div className="space-y-4">
      <ServiceSpaceSelect
        id="appointment-service-space"
        value={state.serviceSpaceId}
        onChange={handleSpaceChange}
        allowGeneral
        label="Subespaço desta marcação"
      />

      <div className="space-y-2">
        <Label htmlFor="professionalService">Serviço</Label>
        {loadingServices ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Carregando catálogo…
          </p>
        ) : filteredServices.length === 0 ? (
          <p className="text-sm text-warning">
            Nenhum serviço ativo no{" "}
            <a href="/dashboard/finances" className="underline underline-offset-2">
              financeiro
            </a>
            {state.serviceSpaceId ? " para este espaço" : ""}
            . Cadastre um serviço para vincular à marcação.
          </p>
        ) : (
          <select
            id="professionalService"
            value={state.professionalServiceId}
            onChange={(e) => handleServiceChange(e.target.value)}
            className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="">Selecione o serviço</option>
            {filteredServices.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <p className="text-xs text-muted-foreground">
          Todo atendimento na agenda corresponde a um serviço do seu catálogo.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="visitKind">Forma de cobrança</Label>
        <select
          id="visitKind"
          value={state.visitKind}
          onChange={(e) =>
            onChange({
              visitKind: e.target.value as AppointmentVisitKindValue,
              ...(e.target.value !== "TREATMENT_PLAN"
                ? { patientServiceSessionId: "" }
                : {}),
            })
          }
          className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
        >
          {BILLING_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {state.visitKind === "TREATMENT_PLAN" && (
        <div className="space-y-2">
          <Label htmlFor="planSession">Sessão do pacote</Label>
          {loadingSessions ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Carregando sessões pendentes…
            </p>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-warning">
              Nenhuma sessão pendente no financeiro para este paciente.
            </p>
          ) : (
            <>
              {selectedPendingSession ? (
                <p className="rounded-md border border-primary/20 bg-primary/5 px-2.5 py-1.5 text-xs text-foreground">
                  Plano ativo: <strong>{selectedPendingSession.serviceName}</strong>
                  {" — "}
                  próxima sessão {selectedPendingSession.sequence}/
                  {selectedPendingSession.totalSessions}
                </p>
              ) : null}
              <select
                id="planSession"
                value={state.patientServiceSessionId}
                onChange={(e) => handleSessionChange(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="">Automático (mais antiga pendente)</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.serviceName} — sessão {s.sequence}/{s.totalSessions}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="careSetting">Local / modalidade</Label>
        <select
          id="careSetting"
          value={state.careSetting}
          onChange={(e) =>
            onChange({ careSetting: e.target.value as AppointmentCareSettingValue })
          }
          className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
        >
          {CARE_SETTING_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="priceReais">Valor (R$, opcional)</Label>
        <Input
          id="priceReais"
          inputMode="decimal"
          value={state.priceReais}
          onChange={(e) => onChange({ priceReais: e.target.value })}
          placeholder="Ex.: 200,00"
        />
        <p className="text-xs text-muted-foreground">
          {state.visitKind === "TREATMENT_PLAN"
            ? "Valor de referência por sessão. A receita do pacote fica no financeiro."
            : "Ao marcar realizada, serviços avulsos e retornos com valor entram automaticamente no financeiro."}
          {" "}Preenchido automaticamente pelo preço padrão do serviço. Não sincroniza com o Google Agenda.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="appointmentNotes">Observações</Label>
        <textarea
          id="appointmentNotes"
          value={state.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder={notesPlaceholder}
          maxLength={2000}
          rows={3}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm min-h-[72px]"
        />
        <p className="text-xs text-muted-foreground">
          Sincroniza com o Google Agenda (texto sanitizado na descrição do evento).
        </p>
      </div>
    </div>
  );
}
