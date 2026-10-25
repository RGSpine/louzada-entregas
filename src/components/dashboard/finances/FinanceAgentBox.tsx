"use client";

import { useRef, useState } from "react";
import { Bot, Loader2, Mic, Square, Upload, Trash2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { getSupportedRecorderMimeOptions, fileExtensionForAudioBlob } from "@/lib/audio-recording-mime";
import { RecordingDurationMarker } from "@/components/dashboard/RecordingDurationMarker";
import { createFinancialTransaction, createPatientPurchase, upsertRecurringExpense } from "@/app/actions/clinic-finances";
import { registerSpokenClientAction } from "@/app/actions/logistics";
import type { FinancialTransactionMethod, RecurringExpenseFrequency } from "@prisma/client";
import { centsToRawInput, rawMoneyToCents, todayInput, METHOD_PT } from "./finance-format";
import { financeOutlineBtnClass, financeOutlineLabelBtnMdClass } from "./finance-outline-btn";
import { ServiceSpaceSelect } from "./ServiceSpaceSelect";
import { pollFinanceAgentUntilDone } from "@/lib/finance-agent-async-client";
import {
  formatPaymentNotes,
  yyyyMmDdToSaoPauloNoon,
} from "@/lib/finance/portuguese-payment";
import {
  type CardInterestMode,
  resolveCardInstallmentFromForm,
} from "@/lib/finance/card-installments";
import { CardInstallmentOptions } from "./CardInstallmentOptions";

const MAX_ATTACHMENTS = 5;

type AgentIntent =
  | "register_income"
  | "register_patient_sale"
  | "register_expense"
  | "define_fixed_expense"
  | "report"
  | "unclear";

type AgentModel = {
  intent: AgentIntent;
  assistantMessage: string;
  confidence: number;
  amountReais?: number | null;
  method?: FinancialTransactionMethod | null;
  installmentCount?: number | null;
  cardKind?: "CREDIT" | "DEBIT" | null;
  occurredDate?: string | null;
  patientNameGuess?: string | null;
  isNewPatient?: boolean | null;
  serviceGuess?: string | null;
  purchaseType?: "SINGLE" | "PACKAGE" | null;
  packageSessions?: number | null;
  registerIncomePaymentGuess?: boolean | null;
  category?: string | null;
  expenseNature?: "FIXED" | "VARIABLE" | null;
  description?: string | null;
  recurringFrequency?: RecurringExpenseFrequency | null;
  recurringAnchorDay?: number | null;
  reportPreset?: string | null;
  reportOffset?: number | null;
};

type AgentProposal = {
  model: AgentModel;
  resolvedPatientId: string | null;
  resolvedServiceId: string | null;
  suggestedAmountCents: number | null;
  suggestedOccurredYyyyMmDd: string | null;
  suggestedInstallmentCount?: number | null;
  suggestedPaymentNote?: string | null;
  suggestedPerformedSessionYyyyMmDd?: string[];
  warnings: string[];
};

type AgentReport = {
  label: string;
  totals: {
    grossIncomeCents: number;
    fixedExpenseCents: number;
    variableExpenseCents: number;
    netCents: number;
  };
} | null;

type DraftKind = "income" | "expense" | "fixed" | "patient_sale";

type Draft = {
  kind: DraftKind;
  amountRaw: string;
  method: FinancialTransactionMethod;
  dateStr: string;
  description: string;
  category: string;
  patientId: string; // "" = nenhum; "__new__" = criar
  newPatientName: string;
  /** Espaço (Consultório/Clínica); vazio = Geral. */
  serviceSpaceId: string;
  // fixos
  name: string;
  frequency: RecurringExpenseFrequency;
  anchorDay: string;
  // venda ao paciente
  serviceId: string;
  purchaseType: "SINGLE" | "PACKAGE";
  packageSessions: string;
  registerPayment: boolean;
  notes: string;
  installmentCount: string;
  interestMode: CardInterestMode;
  interestPercentRaw: string;
  performedSessionDates: string[];
};

type FinanceAgentApiPayload = Partial<{
  success: boolean;
  error?: string;
  proposal?: AgentProposal;
  report?: AgentReport;
  transcript?: string | null;
}>;

function brl(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

export function FinanceAgentBox({
  patients,
  services,
  allowImageUpload,
  maxAudioMinutes,
  financeRole = "ADMIN",
  onChanged,
  onPatientCreated,
}: {
  patients: Array<{ id: string; name: string }>;
  services: Array<{
    id: string;
    name: string;
    defaultPriceCents: number;
    active: boolean;
    serviceSpaceId?: string | null;
  }>;
  allowImageUpload: boolean;
  maxAudioMinutes: number;
  /** MEMBER: só confirma entradas (INCOME); bloqueia venda/despesa/fixo/relatório. */
  financeRole?: "ADMIN" | "MEMBER";
  onChanged: () => void;
  onPatientCreated: () => void;
}) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [imageKey, setImageKey] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [saving, setSaving] = useState(false);

  const [proposal, setProposal] = useState<AgentProposal | null>(null);
  const [report, setReport] = useState<AgentReport>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  // Gravação
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef(0);
  const secAtStopRef = useRef(0);
  const discardRef = useRef(false);

  const capSeconds = Number.isFinite(maxAudioMinutes) ? Math.max(30, maxAudioMinutes * 60) : 7200;

  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function startRecording() {
    if (recording || thinking || saving) return;
    try {
      discardRef.current = false;
      setBlob(null);
      clearTimer();
      tickRef.current = 0;
      setElapsed(0);
      chunksRef.current = [];
      secAtStopRef.current = 0;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const opts = getSupportedRecorderMimeOptions();
      const recorder = opts ? new MediaRecorder(stream, opts) : new MediaRecorder(stream);
      recorder.ondataavailable = (evt) => {
        if (evt.data.size > 0) chunksRef.current.push(evt.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        clearTimer();
        recorderRef.current = null;
        streamRef.current = null;
        setRecording(false);
        if (discardRef.current) {
          discardRef.current = false;
          tickRef.current = 0;
          setElapsed(0);
          return;
        }
        secAtStopRef.current = tickRef.current;
        const mime =
          recorder.mimeType.split(";")[0]?.trim().toLowerCase() ||
          opts?.mimeType.split(";")[0]?.trim().toLowerCase() ||
          "audio/webm";
        const b = new Blob(chunksRef.current, { type: mime || "audio/webm" });
        if (b.size > 0) setBlob(b);
        tickRef.current = 0;
        setElapsed(0);
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      tickRef.current = 0;
      timerRef.current = setInterval(() => {
        tickRef.current += 1;
        setElapsed(tickRef.current);
        if (recorderRef.current && tickRef.current >= capSeconds) {
          try {
            recorderRef.current.stop();
          } catch {
            /* ignore */
          }
        }
      }, 1000);
    } catch {
      toast.error("Não foi possível iniciar o microfone.");
      setRecording(false);
    }
  }

  function stopRecording() {
    discardRef.current = false;
    try {
      recorderRef.current?.stop();
    } catch {
      /* ignore */
    }
  }

  function discardRecording() {
    if (recording) {
      discardRef.current = true;
      try {
        recorderRef.current?.stop();
      } catch {
        clearTimer();
        streamRef.current?.getTracks().forEach((t) => t.stop());
        recorderRef.current = null;
        streamRef.current = null;
        setRecording(false);
      }
    } else {
      setBlob(null);
    }
  }

  function pickImages(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []).filter((f) => f.size > 0);
    if (!picked.length) return;
    if (!allowImageUpload) {
      toast.error("Seu plano permite só texto/áudio. Faça upgrade para anexar comprovantes.");
      setImageKey((x) => x + 1);
      return;
    }
    setImages((prev) => [...prev, ...picked].slice(0, MAX_ATTACHMENTS));
    setImageKey((x) => x + 1);
    e.target.value = "";
  }

  function draftFromProposal(p: AgentProposal): Draft | null {
    const m = p.model;
    const resolvedSvc = p.resolvedServiceId
      ? services.find((s) => s.id === p.resolvedServiceId)
      : null;
    const inferredInstallments = m.installmentCount ?? p.suggestedInstallmentCount ?? null;
    const inferredMethod =
      (m.method as FinancialTransactionMethod | null | undefined) ??
      (inferredInstallments != null ? ("CARD" as const) : null) ??
      (p.suggestedPaymentNote?.toLowerCase().includes("pix")
        ? ("PIX" as const)
        : p.suggestedPaymentNote?.toLowerCase().includes("dinheiro")
          ? ("CASH" as const)
          : null);
    const paymentNote =
      p.suggestedPaymentNote ??
      formatPaymentNotes({
        method: inferredMethod,
        cardKind: m.cardKind ?? (inferredInstallments != null ? "CREDIT" : null),
        installmentCount: inferredInstallments,
      });
    const base = {
      amountRaw: p.suggestedAmountCents ? centsToRawInput(p.suggestedAmountCents) : "",
      method: (inferredMethod ?? "PIX") as FinancialTransactionMethod,
      dateStr: p.suggestedOccurredYyyyMmDd ?? todayInput(),
      description: [m.description ?? "", paymentNote].filter(Boolean).join(m.description && paymentNote ? " · " : ""),
      category: m.category ?? "",
      patientId: p.resolvedPatientId ?? (m.isNewPatient && m.patientNameGuess ? "__new__" : ""),
      newPatientName: m.patientNameGuess ?? "",
      name: m.description || m.category || "Despesa fixa",
      frequency: (m.recurringFrequency ?? "MONTHLY") as RecurringExpenseFrequency,
      anchorDay: String(m.recurringAnchorDay ?? 1),
      serviceSpaceId: resolvedSvc?.serviceSpaceId ?? "",
      installmentCount: inferredInstallments != null ? String(inferredInstallments) : "",
      interestMode: "none" as CardInterestMode,
      interestPercentRaw: "",
      performedSessionDates: p.suggestedPerformedSessionYyyyMmDd ?? [],
    };
    if (m.intent === "register_income") {
      return {
        kind: "income",
        ...base,
        serviceId: "",
        purchaseType: "SINGLE",
        packageSessions: "1",
        registerPayment: true,
        notes: "",
      };
    }
    if (m.intent === "register_patient_sale") {
      const purchaseType =
        m.purchaseType ??
        ((p.suggestedPerformedSessionYyyyMmDd?.length ?? 0) > 0 ? "PACKAGE" : "SINGLE");
      const defaultCents = p.suggestedAmountCents ?? resolvedSvc?.defaultPriceCents ?? null;
      return {
        kind: "patient_sale",
        ...base,
        amountRaw: defaultCents ? centsToRawInput(defaultCents) : base.amountRaw,
        serviceId: p.resolvedServiceId ?? "",
        purchaseType,
        packageSessions: String(
          m.packageSessions ??
            (purchaseType === "PACKAGE"
              ? Math.max(10, p.suggestedPerformedSessionYyyyMmDd?.length ?? 0)
              : 1),
        ),
        registerPayment: m.registerIncomePaymentGuess !== false || Boolean(m.method),
        notes: [m.description ?? "", paymentNote].filter(Boolean).join(m.description && paymentNote ? " · " : ""),
        patientId: p.resolvedPatientId ?? (m.isNewPatient && m.patientNameGuess ? "__new__" : ""),
      };
    }
    if (m.intent === "register_expense") {
      return {
        kind: "expense",
        ...base,
        serviceId: "",
        purchaseType: "SINGLE",
        packageSessions: "1",
        registerPayment: true,
        notes: "",
      };
    }
    if (m.intent === "define_fixed_expense") {
      return {
        kind: "fixed",
        ...base,
        serviceId: "",
        purchaseType: "SINGLE",
        packageSessions: "1",
        registerPayment: true,
        notes: "",
      };
    }
    return null;
  }

  function applyAgentResponse(data: FinanceAgentApiPayload) {
    if (!data?.success || !data.proposal) {
      toast.error(
        typeof data?.error === "string" && data.error.length > 0
          ? data.error
          : "O agente não conseguiu interpretar o pedido.",
      );
      return;
    }
    data.proposal.warnings.forEach((w) => toast.warning(w, { duration: 6000 }));
    setProposal(data.proposal);
    setReport(data.report ?? null);
    setDraft(draftFromProposal(data.proposal));
    resetInputs();
  }

  async function submit() {
    const hasAudio = !!(blob && blob.size > 0);
    if (!text.trim() && !hasAudio && images.length === 0) {
      toast.error("Escreva, grave ou anexe algo para o agente interpretar.");
      return;
    }
    if (recording) {
      toast.error("Finalize a gravação antes de enviar.");
      return;
    }
    setThinking(true);
    setProposal(null);
    setReport(null);
    setDraft(null);
    try {
      const fd = new FormData();
      if (text.trim()) fd.append("text", text.trim());
      if (hasAudio && blob) {
        const baseMime = blob.type.split(";")[0]?.trim().toLowerCase() || "audio/webm";
        const ext = fileExtensionForAudioBlob(baseMime);
        fd.append("audio", new File([blob], `agente-financeiro.${ext}`, { type: baseMime }));
        fd.append("audioDurationSec", String(Math.min(secAtStopRef.current || 0, capSeconds)));
      }
      images.forEach((f) => fd.append("imageFiles", f));

      const res = await fetch("/api/finance-agent", { method: "POST", body: fd });

      let data: FinanceAgentApiPayload | null = null;

      if (res.status === 202) {
        toast.info(
          "Áudio longo: o agente está a processar em segundo plano. Aguarde alguns instantes…",
          { duration: 8000 },
        );
        const queued = (await res.json().catch(() => null)) as Partial<{ jobId?: string }> | null;
        if (typeof queued?.jobId !== "string" || queued.jobId.length < 4) {
          toast.error("Resposta de fila assíncrona inválida.");
          return;
        }
        try {
          const polled = await pollFinanceAgentUntilDone(queued.jobId);
          data = polled as FinanceAgentApiPayload;
        } catch (pollErr) {
          toast.error(
            pollErr instanceof Error
              ? pollErr.message
              : "Falha ao aguardar resultado do agente.",
          );
          return;
        }
      } else {
        data = (await res.json().catch(() => null)) as FinanceAgentApiPayload;
        if (!res.ok) {
          toast.error(
            typeof data?.error === "string" && data.error.length > 0
              ? data.error
              : "Pedido rejeitado pelo servidor.",
          );
          return;
        }
      }

      applyAgentResponse(data ?? {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao falar com o agente.");
    } finally {
      setThinking(false);
    }
  }

  function resetInputs() {
    setText("");
    setImages([]);
    setBlob(null);
    setImageKey((k) => k + 1);
    secAtStopRef.current = 0;
  }

  async function confirmDraft() {
    if (!draft) return;
    if (financeRole === "MEMBER") {
      if (draft.kind !== "income") {
        toast.error(
          "Membros da equipe só podem confirmar entradas (receitas). Peça a um administrador as demais operações.",
        );
        return;
      }
    }
    if (draft.kind === "income") {
      if (!draft.patientId || (draft.patientId === "__new__" && !draft.newPatientName.trim())) {
        toast.error(
          "Vincule a entrada a um cliente — selecione no menu ou crie a partir do nome citado no áudio.",
        );
        return;
      }
    }
    if (draft.kind === "patient_sale") {
      if (!draft.patientId && !draft.newPatientName.trim()) {
        toast.error("Informe o paciente da venda.");
        return;
      }
    }
    const cents = rawMoneyToCents(draft.amountRaw);
    if (cents === null || cents <= 0) {
      toast.error("Informe um valor válido.");
      return;
    }
    setSaving(true);
    try {
      if (draft.kind === "fixed") {
        const res = await upsertRecurringExpense({
          name: draft.name || "Despesa fixa",
          amountCents: cents,
          category: draft.category || undefined,
          frequency: draft.frequency,
          anchorDay: Number(draft.anchorDay) || 1,
          method: draft.method,
          ...(draft.serviceSpaceId.trim()
            ? { serviceSpaceId: draft.serviceSpaceId.trim() }
            : { serviceSpaceId: null }),
        });
        if (!res.success) {
          toast.error(res.error);
          return;
        }
        toast.success("Gasto fixo salvo.");
      } else if (draft.kind === "patient_sale") {
        if (!draft.serviceId) {
          toast.error("Escolha o serviço vendido.");
          return;
        }
        if (!draft.patientId && !draft.newPatientName.trim()) {
          toast.error("Informe o cliente da venda.");
          return;
        }

        let patientId =
          draft.patientId && draft.patientId !== "__new__" ? draft.patientId : "";

        if (draft.patientId === "__new__" && draft.newPatientName.trim()) {
          const created = await registerSpokenClientAction({
            clientName: draft.newPatientName.trim(),
            address: null,
            phone: null,
          });
          if (!created.ok || !created.dentistClientId) {
            toast.error(created.ok ? "Não foi possível criar o cliente." : created.error);
            return;
          }
          patientId = created.dentistClientId;
          onPatientCreated();
        }

        if (!patientId) {
          toast.error("Selecione ou crie o cliente.");
          return;
        }

        const installmentN = Number(draft.installmentCount) || 0;
        let chargeCents = cents;
        let payNote: string | null = null;
        if (draft.registerPayment && draft.method === "CARD") {
          const resolved = resolveCardInstallmentFromForm({
            baseAmountCents: cents,
            installmentCountRaw: draft.installmentCount,
            interestMode: draft.interestMode,
            interestPercentRaw: draft.interestPercentRaw,
          });
          if (!resolved.ok) {
            toast.error(resolved.error);
            return;
          }
          if (resolved.plan) {
            chargeCents = resolved.plan.totalCents;
            payNote = resolved.notes;
          } else {
            payNote = formatPaymentNotes({
              method: "CARD",
              cardKind: "CREDIT",
              installmentCount: null,
            });
          }
        } else if (draft.registerPayment && installmentN >= 2) {
          payNote = formatPaymentNotes({
            method: draft.method,
            cardKind: "CREDIT",
            installmentCount: installmentN,
          });
        }
        if (chargeCents !== cents) {
          const ok = window.confirm(
            `Total no caixa: R$ ${(chargeCents / 100).toFixed(2).replace(".", ",")} (catálogo R$ ${(cents / 100).toFixed(2).replace(".", ",")} + juros). Confirmar?`,
          );
          if (!ok) return;
        }
        const notesMerged = [draft.notes.trim(), payNote]
          .filter(Boolean)
          .filter((v, i, a) => a.indexOf(v) === i)
          .join(" · ");

        const res = await createPatientPurchase({
          patientId,
          professionalServiceId: draft.serviceId,
          type: "SINGLE",
          agreedPriceCents: cents,
          ...(chargeCents !== cents ? { paymentAmountCents: chargeCents } : {}),
          notes: notesMerged || undefined,
          registerIncomePayment: draft.registerPayment,
          ...(draft.serviceSpaceId.trim()
            ? { serviceSpaceId: draft.serviceSpaceId.trim() }
            : {}),
          ...(draft.registerPayment
            ? {
                paymentMethod: draft.method,
                paymentOccurredAt:
                  yyyyMmDdToSaoPauloNoon(draft.dateStr) ??
                  new Date(draft.dateStr + "T12:00:00-03:00"),
                paymentDescription:
                  payNote || draft.description.trim() || undefined,
              }
            : {}),
        });
        if (!res.success) {
          toast.error(res.error);
          return;
        }
        toast.success("Venda registrada.");
      } else {
        // income | expense
        if (draft.kind === "income") {
          let incomePatientId: string | undefined =
            draft.patientId && draft.patientId !== "__new__" ? draft.patientId : undefined;

          if (draft.patientId === "__new__" && draft.newPatientName.trim()) {
            const created = await registerSpokenClientAction({
              clientName: draft.newPatientName.trim(),
              address: null,
              phone: null,
            });
            if (!created.ok || !created.dentistClientId) {
              toast.error(created.ok ? "Não foi possível criar o cliente." : created.error);
              return;
            }
            incomePatientId = created.dentistClientId;
            onPatientCreated();
          }

          if (!incomePatientId) {
            toast.error("Selecione ou crie o cliente da entrada.");
            return;
          }

          const installmentN = Number(draft.installmentCount) || 0;
          let chargeCents = cents;
          let payNote: string | null = null;
          if (draft.method === "CARD") {
            const resolved = resolveCardInstallmentFromForm({
              baseAmountCents: cents,
              installmentCountRaw: draft.installmentCount,
              interestMode: draft.interestMode,
              interestPercentRaw: draft.interestPercentRaw,
            });
            if (!resolved.ok) {
              toast.error(resolved.error);
              return;
            }
            if (resolved.plan) {
              chargeCents = resolved.plan.totalCents;
              payNote = resolved.notes;
            } else {
              payNote = formatPaymentNotes({
                method: "CARD",
                cardKind: "CREDIT",
                installmentCount: null,
              });
            }
          } else {
            payNote = formatPaymentNotes({
              method: draft.method,
              cardKind: null,
              installmentCount: installmentN >= 2 ? installmentN : null,
            });
          }

          if (chargeCents !== cents) {
            const ok = window.confirm(
              `Total no caixa: R$ ${(chargeCents / 100).toFixed(2).replace(".", ",")} (valor informado R$ ${(cents / 100).toFixed(2).replace(".", ",")} + juros). Confirmar?`,
            );
            if (!ok) return;
          }

          const descriptionMerged = [draft.description.trim(), payNote]
            .filter(Boolean)
            .filter((v, i, a) => a.indexOf(v) === i)
            .join(" · ");

          const res = await createFinancialTransaction({
            kind: "INCOME",
            amountCents: chargeCents,
            occurredAt:
              yyyyMmDdToSaoPauloNoon(draft.dateStr) ??
              new Date(draft.dateStr + "T12:00:00-03:00"),
            method: draft.method,
            description: descriptionMerged || undefined,
            patientId: incomePatientId,
            category: draft.category || undefined,
            source: "AGENT",
            ...(draft.serviceSpaceId.trim()
              ? { serviceSpaceId: draft.serviceSpaceId.trim() }
              : {}),
          });
          if (!res.success) {
            toast.error(res.error);
            return;
          }
          toast.success(
            res.data?.linkedPurchaseId
              ? "Entrada registrada e vinculada à venda pendente do cliente."
              : "Entrada registrada e vinculada ao cliente.",
          );
        } else {
        // expense (sem paciente obrigatório)
        let patientId: string | undefined =
          draft.patientId && draft.patientId !== "__new__" ? draft.patientId : undefined;

        if (draft.patientId === "__new__" && draft.newPatientName.trim()) {
          const created = await registerSpokenClientAction({
            clientName: draft.newPatientName.trim(),
            address: null,
            phone: null,
          });
          if (!created.ok || !created.dentistClientId) {
            toast.error(created.ok ? "Não foi possível criar o cliente." : created.error);
            return;
          }
          patientId = created.dentistClientId;
          onPatientCreated();
        }

        const installmentN = Number(draft.installmentCount) || 0;
        let chargeCents = cents;
        let payNote: string | null = null;
        if (draft.method === "CARD") {
          const resolved = resolveCardInstallmentFromForm({
            baseAmountCents: cents,
            installmentCountRaw: draft.installmentCount,
            interestMode: draft.interestMode,
            interestPercentRaw: draft.interestPercentRaw,
          });
          if (!resolved.ok) {
            toast.error(resolved.error);
            return;
          }
          if (resolved.plan) {
            chargeCents = resolved.plan.totalCents;
            payNote = resolved.notes;
          } else {
            payNote = formatPaymentNotes({
              method: "CARD",
              cardKind: "CREDIT",
              installmentCount: null,
            });
          }
        } else {
          payNote = formatPaymentNotes({
            method: draft.method,
            cardKind: null,
            installmentCount: installmentN >= 2 ? installmentN : null,
          });
        }
        const descriptionMerged = [draft.description.trim(), payNote]
          .filter(Boolean)
          .filter((v, i, a) => a.indexOf(v) === i)
          .join(" · ");

        const res = await createFinancialTransaction({
          kind: "EXPENSE",
          amountCents: chargeCents,
          occurredAt:
            yyyyMmDdToSaoPauloNoon(draft.dateStr) ??
            new Date(draft.dateStr + "T12:00:00-03:00"),
          method: draft.method,
          description: descriptionMerged || undefined,
          patientId,
          category: draft.category || undefined,
          source: "AGENT",
          ...(draft.serviceSpaceId.trim()
            ? { serviceSpaceId: draft.serviceSpaceId.trim() }
            : {}),
          expenseNature: "VARIABLE" as const,
        });
        if (!res.success) {
          toast.error(res.error);
          return;
        }
        toast.success("Despesa registrada.");
        }
      }
      setProposal(null);
      setDraft(null);
      setReport(null);
      resetInputs();
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  const intentLabel: Record<AgentIntent, string> = {
    register_income: "Registrar entrada",
    register_patient_sale: "Venda do trabalho",
    register_expense: "Registrar despesa",
    define_fixed_expense: "Salvar gasto fixo",
    report: "Saúde financeira / relatório",
    unclear: "Preciso de mais detalhes",
  };

  const activeServices = services.filter((s) => s.active);

  return (
    <Card className="border-clinical/30 bg-gradient-to-b from-clinical/10 to-white shadow-sm dark:border-clinical/30 dark:from-clinical/20 dark:to-card lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-clinical" aria-hidden />
          Assistente financeiro
        </CardTitle>
        <CardDescription>
          Registre por voz/texto/comprovante ou pergunte sobre o caixa — o agente decide a
          intenção. Exemplos: «Antônia comprou plano de 8 em 3x», «aluguel 2.500 todo dia 5»,
          «gastei 400 no conserto», «como está meu líquido este mês?». Nada é gravado sem a sua
          confirmação.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="Ex.: registrei venda… / aluguel… / como está minha saúde financeira este mês?"
          disabled={thinking || saving}
        />

        <div className="flex flex-wrap items-center gap-3">
          {!recording ? (
            <Button
              type="button"
              variant="outline"
              className={financeOutlineBtnClass}
              disabled={thinking || saving}
              onClick={() => void startRecording()}
            >
              <Mic className="mr-2 h-4 w-4" aria-hidden /> Gravar
            </Button>
          ) : (
            <>
              <RecordingDurationMarker elapsedSeconds={elapsed} maxSeconds={capSeconds} />
              <Button type="button" className="bg-clinical hover:bg-clinical/90" onClick={stopRecording}>
                <Square className="mr-2 h-4 w-4" aria-hidden /> Parar
              </Button>
              <Button type="button" variant="ghost" className="text-foreground/90 dark:text-foreground" onClick={discardRecording}>
                Descartar
              </Button>
            </>
          )}

          <label
            className={cn(
              financeOutlineLabelBtnMdClass,
              (!allowImageUpload || images.length >= MAX_ATTACHMENTS) && "cursor-not-allowed opacity-60",
            )}
          >
            <Upload className="mr-2 h-4 w-4" aria-hidden />
            Comprovante
            <input
              key={imageKey}
              type="file"
              className="sr-only"
              accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp"
              multiple
              disabled={thinking || saving || !allowImageUpload || images.length >= MAX_ATTACHMENTS}
              onChange={pickImages}
            />
          </label>

          <Button
            type="button"
            className="ml-auto bg-clinical hover:bg-clinical/90"
            disabled={thinking || saving || recording}
            onClick={() => void submit()}
          >
            {thinking ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Interpretando…
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" /> Perguntar ao agente
              </>
            )}
          </Button>
        </div>

        {blob && blob.size > 0 && !recording && (
          <p className="text-sm font-medium text-clinical dark:text-clinical">
            Áudio pronto ({(blob.size / 1024).toFixed(0)} KB).
          </p>
        )}
        {images.length > 0 && (
          <ul className="space-y-1 text-sm text-foreground/90">
            {images.map((f, idx) => (
              <li
                key={`${f.name}-${idx}`}
                className="flex items-center justify-between gap-2 rounded-md bg-muted px-2 py-1 dark:bg-muted/70"
              >
                <span className="truncate">{f.name}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Remover ${f.name}`}
                  onClick={() => setImages((prev) => prev.filter((_, i) => i !== idx))}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {/* Proposta do agente */}
        {proposal && (
          <div className="rounded-xl border border-clinical/30 bg-white p-4 shadow-sm dark:border-clinical/40 dark:bg-card">
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded-full bg-clinical/15 px-2 py-0.5 text-xs font-semibold text-clinical dark:bg-clinical/20 dark:text-clinical">
                {intentLabel[proposal.model.intent]}
              </span>
              <span className="text-xs text-muted-foreground">
                confiança {Math.round(proposal.model.confidence * 100)}%
              </span>
            </div>
            {proposal.model.assistantMessage && (
              <p className="mb-3 text-sm text-foreground/90">{proposal.model.assistantMessage}</p>
            )}

            {/* Relatório */}
            {proposal.model.intent === "report" && report && (
              <div className="mt-2 grid gap-2 rounded-lg border border-clinical/20 bg-clinical/5 p-3 sm:grid-cols-2">
                <p className="text-sm font-semibold sm:col-span-2">{report.label}</p>
                <p className="text-sm">
                  Bruto:{" "}
                  <strong className="text-clinical dark:text-clinical">
                    {brl(report.totals.grossIncomeCents)}
                  </strong>
                </p>
                <p className="text-sm">
                  Líquido:{" "}
                  <strong
                    className={
                      report.totals.netCents < 0 ? "text-destructive" : "text-clinical"
                    }
                  >
                    {brl(report.totals.netCents)}
                  </strong>
                </p>
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  Fixas {brl(report.totals.fixedExpenseCents)} · Variáveis{" "}
                  {brl(report.totals.variableExpenseCents)} · detalhe completo na aba Analisar.
                </p>
              </div>
            )}

            {/* Confirmação editável de lançamento / gasto fixo / venda */}
            {draft && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <ServiceSpaceSelect
                    id="d-space"
                    value={draft.serviceSpaceId}
                    onChange={(spaceId) => setDraft({ ...draft, serviceSpaceId: spaceId })}
                    label="Espaço deste lançamento"
                    disabled={saving}
                  />
                </div>
                {draft.kind === "fixed" && (
                  <div className="sm:col-span-2">
                    <Label htmlFor="d-name">Nome do gasto fixo</Label>
                    <Input id="d-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                  </div>
                )}

                {draft.kind === "patient_sale" && (
                  <>
                    <div>
                      <Label htmlFor="d-patient-sale">Cliente</Label>
                      <select
                        id="d-patient-sale"
                        className="flex h-10 w-full rounded-md border border-border bg-white px-3 text-sm dark:border-border dark:bg-card"
                        value={draft.patientId}
                        onChange={(e) => setDraft({ ...draft, patientId: e.target.value })}
                      >
                        <option value="">— Selecione —</option>
                        {draft.newPatientName && <option value="__new__">+ Criar &ldquo;{draft.newPatientName}&rdquo;</option>}
                        {patients.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="d-service">Serviço</Label>
                      <select
                        id="d-service"
                        className="flex h-10 w-full rounded-md border border-border bg-white px-3 text-sm dark:border-border dark:bg-card"
                        value={draft.serviceId}
                        onChange={(e) => {
                          const svc = activeServices.find((s) => s.id === e.target.value);
                          setDraft({
                            ...draft,
                            serviceId: e.target.value,
                            amountRaw:
                              !draft.amountRaw && svc
                                ? centsToRawInput(svc.defaultPriceCents)
                                : draft.amountRaw,
                            ...(svc?.serviceSpaceId
                              ? { serviceSpaceId: svc.serviceSpaceId }
                              : {}),
                          });
                        }}
                      >
                        <option value="">— Selecione —</option>
                        {activeServices.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({brl(s.defaultPriceCents)})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={draft.registerPayment}
                          onChange={(e) => setDraft({ ...draft, registerPayment: e.target.checked })}
                        />
                        Registrar recebimento no caixa agora
                      </label>
                    </div>
                  </>
                )}

                <div>
                  <Label htmlFor="d-amount">Valor (R$)</Label>
                  <Input
                    id="d-amount"
                    inputMode="decimal"
                    value={draft.amountRaw}
                    onChange={(e) => setDraft({ ...draft, amountRaw: e.target.value })}
                  />
                </div>
                {(draft.kind !== "fixed" && (draft.kind !== "patient_sale" || draft.registerPayment)) && (
                  <div className="sm:col-span-2 space-y-2">
                    {draft.method === "CARD" && Number(draft.installmentCount) >= 2 ? (
                      <p className="rounded-md border border-clinical/30 bg-clinical/5 px-3 py-2 text-xs text-foreground">
                        Detectado do áudio/texto:{" "}
                        <strong>
                          Cartão de crédito em {Number(draft.installmentCount)}x
                        </strong>
                        . Padrão: <strong>sem juros</strong> (valor do catálogo). Se
                        houver juros, escolha «Com juros» e informe a %.
                      </p>
                    ) : draft.method !== "PIX" || draft.description.includes("PIX") ? (
                      <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                        Forma de pagamento pré-preenchida a partir do áudio/texto. Ajuste
                        manualmente só se estiver incorreta.
                      </p>
                    ) : null}
                    <div>
                    <Label htmlFor="d-method">Forma</Label>
                    <select
                      id="d-method"
                      className="flex h-10 w-full rounded-md border border-border bg-white px-3 text-sm dark:border-border dark:bg-card"
                      value={draft.method}
                      onChange={(e) => {
                        const next = e.target.value as FinancialTransactionMethod;
                        setDraft({
                          ...draft,
                          method: next,
                          ...(next !== "CARD"
                            ? {
                                installmentCount: "",
                                interestMode: "none" as CardInterestMode,
                                interestPercentRaw: "",
                              }
                            : {}),
                        });
                      }}
                    >
                      {(Object.entries(METHOD_PT) as Array<[FinancialTransactionMethod, string]>).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                    </div>
                  </div>
                )}

                {draft.method === "CARD" &&
                  (draft.kind === "income" ||
                    draft.kind === "expense" ||
                    (draft.kind === "patient_sale" && draft.registerPayment)) && (
                  <CardInstallmentOptions
                    idPrefix="agent-d"
                    installmentCount={draft.installmentCount}
                    onInstallmentCountChange={(v) =>
                      setDraft({ ...draft, installmentCount: v })
                    }
                    interestMode={draft.interestMode}
                    onInterestModeChange={(mode) =>
                      setDraft({ ...draft, interestMode: mode })
                    }
                    interestPercentRaw={draft.interestPercentRaw}
                    onInterestPercentRawChange={(v) =>
                      setDraft({ ...draft, interestPercentRaw: v })
                    }
                    baseAmountCents={rawMoneyToCents(draft.amountRaw)}
                  />
                )}

                {draft.kind !== "fixed" && (draft.kind !== "patient_sale" || draft.registerPayment) && (
                  <div>
                    <Label htmlFor="d-date">Data</Label>
                    <Input
                      id="d-date"
                      type="date"
                      value={draft.dateStr}
                      onChange={(e) => setDraft({ ...draft, dateStr: e.target.value })}
                    />
                  </div>
                )}

                {draft.kind === "fixed" && (
                  <div>
                    <Label htmlFor="d-freq">Frequência</Label>
                    <select
                      id="d-freq"
                      className="flex h-10 w-full rounded-md border border-border bg-white px-3 text-sm dark:border-border dark:bg-card"
                      value={draft.frequency}
                      onChange={(e) => setDraft({ ...draft, frequency: e.target.value as RecurringExpenseFrequency })}
                    >
                      <option value="WEEKLY">Semanal</option>
                      <option value="MONTHLY">Mensal</option>
                      <option value="YEARLY">Anual</option>
                    </select>
                  </div>
                )}

                {draft.kind !== "patient_sale" && (
                  <div>
                    <Label htmlFor="d-cat">Categoria</Label>
                    <Input id="d-cat" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
                  </div>
                )}

                {draft.kind === "income" && (
                  <div className="sm:col-span-2 space-y-2">
                    <Label htmlFor="d-patient">Cliente (obrigatório)</Label>
                    <select
                      id="d-patient"
                      className="flex h-10 w-full rounded-md border border-border bg-white px-3 text-sm dark:border-border dark:bg-card"
                      value={draft.patientId}
                      onChange={(e) => setDraft({ ...draft, patientId: e.target.value })}
                      required
                    >
                      <option value="">Selecione o cliente</option>
                      {draft.newPatientName && (
                        <option value="__new__">+ Criar &ldquo;{draft.newPatientName}&rdquo;</option>
                      )}
                      {patients.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    {draft.patientId === "__new__" ? (
                      <Input
                        placeholder="Nome do novo cliente"
                        value={draft.newPatientName}
                        onChange={(e) =>
                          setDraft({ ...draft, newPatientName: e.target.value })
                        }
                      />
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      Toda receita fica ligada a um cliente do laboratório, na coleta ou na entrega.
                    </p>
                  </div>
                )}

                <div className="sm:col-span-2">
                  <Label htmlFor="d-desc">
                    {draft.kind === "patient_sale" ? "Observações da venda" : "Descrição"}
                  </Label>
                  <Textarea
                    id="d-desc"
                    rows={2}
                    value={draft.kind === "patient_sale" ? draft.notes : draft.description}
                    onChange={(e) =>
                      setDraft(
                        draft.kind === "patient_sale"
                          ? { ...draft, notes: e.target.value }
                          : { ...draft, description: e.target.value },
                      )
                    }
                  />
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {draft && (
                <Button
                  type="button"
                  className="bg-clinical hover:bg-clinical/90"
                  disabled={saving}
                  onClick={() => void confirmDraft()}
                >
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Confirmar e gravar
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                onClick={() => {
                  setProposal(null);
                  setDraft(null);
                  setReport(null);
                }}
              >
                Descartar sugestão
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
