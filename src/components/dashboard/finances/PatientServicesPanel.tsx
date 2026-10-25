"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FinanceFormIntakeToolbar } from "./FinanceFormIntakeToolbar";
import { formatBrlFromCents, rawMoneyToCents, todayInput } from "./finance-format";
import {
  consumePatientPurchaseSessionsByDates,
  consumeServiceSessionManual,
  createFinancialTransaction,
  createPatientPurchase,
  getFinanceAccess,
  listPatientCashEntries,
  listPatientPurchases,
  listProfessionalServices,
} from "@/app/actions/clinic-finances";
import { getMyPlanLimits } from "@/app/actions/billing";
import { PremiumFeatureTeaserCard } from "@/components/premium/PremiumFeatureTeaserCard";
import type { FinancialTransactionMethod } from "@prisma/client";
import type { OfficeFinanceExtractionEnvelope } from "@/lib/office-finance-ai-extract";
import { toast } from "sonner";
import {
  dismissCommercialPlanReminder,
  readCommercialPlanReminder,
  type CommercialPlanReminderPayload,
} from "@/lib/evolution-commercial-plan";
import { buildFinanceDeepLink } from "@/lib/finance/finance-deep-link";
import { ServiceSpaceSelect } from "./ServiceSpaceSelect";
import {
  formatPaymentNotes,
  yyyyMmDdToSaoPauloNoon,
} from "@/lib/finance/portuguese-payment";
import {
  formatPackageNearEndWarning,
  isPackageApproachingEnd,
} from "@/lib/finance/evolution-session-consumption";
import {
  formatMonthlyMidPeriodWarning,
  isMonthlyPlanMidPeriod,
} from "@/lib/finance/service-billing-mode";
import {
  type CardInterestMode,
  resolveCardInstallmentFromForm,
} from "@/lib/finance/card-installments";
import { CardInstallmentOptions } from "./CardInstallmentOptions";

const METHOD_LABELS: Record<FinancialTransactionMethod, string> = {
  PIX: "PIX",
  CASH: "Dinheiro",
  CARD: "Cartão",
  TRANSFER: "Transferência",
  OTHER: "Outro",
};

function newCommandKey(): string {
  return `patient-sale:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

type ServiceDraft = {
  key: string;
  serviceId: string;
  purchaseType: "SINGLE" | "PACKAGE";
  sessionCount: string;
  priceRaw: string;
  notes: string;
  /** yyyy-mm-dd das sessões já realizadas (áudio ou seletor manual). */
  performedSessionDates: string[];
};

type ServicesResult = NonNullable<Extract<
  Awaited<ReturnType<typeof listProfessionalServices>>,
  { success: true }
>["data"]>;
type PurchasesResult = NonNullable<Extract<
  Awaited<ReturnType<typeof listPatientPurchases>>,
  { success: true }
>["data"]>;
type CashEntriesResult = NonNullable<Extract<
  Awaited<ReturnType<typeof listPatientCashEntries>>,
  { success: true }
>["data"]>;

export function PatientServicesPanel({
  patientId,
  patientName,
  highlightSessionId = null,
}: {
  patientId: string;
  patientName: string;
  /** Sessão recém-baixada pela evolução — destaca na lista. */
  highlightSessionId?: string | null;
}) {
  const [services, setServices] = useState<ServicesResult>([]);
  const [purchases, setPurchases] = useState<PurchasesResult>([]);
  const [cashEntries, setCashEntries] = useState<CashEntriesResult>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [serviceToAddId, setServiceToAddId] = useState("");
  const [drafts, setDrafts] = useState<ServiceDraft[]>([]);
  /** Rascunho de baixa de sessões em plano já existente (áudio). */
  const [sessionUpdateDraft, setSessionUpdateDraft] = useState<{
    purchaseId: string;
    dates: string[];
    summary: string | null;
  } | null>(null);
  const [sessionDates, setSessionDates] = useState<Record<string, string>>({});
  const [registerPayment, setRegisterPayment] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<FinancialTransactionMethod>("PIX");
  const [installmentCount, setInstallmentCount] = useState<string>("");
  const [interestMode, setInterestMode] = useState<CardInterestMode>("none");
  const [interestPercentRaw, setInterestPercentRaw] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayInput());
  /** Data avulsa a adicionar ao rascunho de sessões já realizadas. */
  const [draftPerformedDateToAdd, setDraftPerformedDateToAdd] = useState(todayInput());
  /** Compra com pagamento pendente em modo «receber agora» (não mistura com nova venda). */
  const [collectingPurchaseId, setCollectingPurchaseId] = useState<string | null>(null);
  const [collectMethod, setCollectMethod] = useState<FinancialTransactionMethod>("PIX");
  const [collectInstallmentCount, setCollectInstallmentCount] = useState("");
  const [collectInterestMode, setCollectInterestMode] = useState<CardInterestMode>("none");
  const [collectInterestPercentRaw, setCollectInterestPercentRaw] = useState("");
  const [collectDate, setCollectDate] = useState(todayInput());
  const [collectPriceRaw, setCollectPriceRaw] = useState("");
  const [financePlan, setFinancePlan] = useState<{
    maxAudioMinutes: number;
    officeFinanceAllowsImageUpload: boolean;
    canUseOfficeFinance: boolean;
  } | null>(null);
  const [planReminder, setPlanReminder] = useState<CommercialPlanReminderPayload | null>(null);
  const [saleSpaceId, setSaleSpaceId] = useState("");
  /** MEMBER sem flag: só leitura da lista de compras. */
  const [canManagePatientServices, setCanManagePatientServices] = useState(true);

  const activeServices = useMemo(
    () =>
      (services ?? []).filter((service) => {
        if (!service.active) return false;
        if (!saleSpaceId) return true;
        return (
          service.serviceSpaceId === saleSpaceId || service.serviceSpaceId == null
        );
      }),
    [services, saleSpaceId],
  );

  const load = useCallback(async () => {
    const [serviceResult, purchaseResult, cashResult, planResult, accessResult] =
      await Promise.all([
        listProfessionalServices(),
        listPatientPurchases(patientId),
        listPatientCashEntries(patientId),
        getMyPlanLimits(),
        getFinanceAccess(),
      ]);
    if (accessResult.success && accessResult.data) {
      setCanManagePatientServices(accessResult.data.canManagePatientServices);
    } else if (!accessResult.success) {
      // Sem acesso financeiro resolvido: fail-closed nas mutações.
      setCanManagePatientServices(false);
    }
    if (serviceResult.success) {
      setServices(serviceResult.data ?? []);
    } else {
      toast.error(serviceResult.error);
    }
    if (purchaseResult.success) {
      setPurchases(purchaseResult.data ?? []);
    } else {
      toast.error(purchaseResult.error);
    }
    if (cashResult.success) {
      setCashEntries(cashResult.data ?? []);
    } else {
      // Não bloquear a ficha se o extrato falhar — compras já carregaram.
      setCashEntries([]);
    }
    if (planResult.success && planResult.limits) {
      setFinancePlan({
        maxAudioMinutes: planResult.limits.maxAudioMinutes,
        officeFinanceAllowsImageUpload: Boolean(planResult.officeFinanceAllowsImageUpload),
        canUseOfficeFinance: planResult.canUseOfficeFinance === true,
      });
    } else {
      // Plano resolvido sem acesso (ou falha) — evita teaser falso e loading eterno.
      setFinancePlan({
        maxAudioMinutes: 5,
        officeFinanceAllowsImageUpload: false,
        canUseOfficeFinance: false,
      });
    }
    setLoading(false);
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPlanReminder(readCommercialPlanReminder(patientId));
  }, [patientId]);

  function dismissPlanReminder() {
    dismissCommercialPlanReminder(patientId);
    setPlanReminder(null);
  }

  function addServiceToSelection(serviceId = serviceToAddId) {
    const selected = activeServices.find((service) => service.id === serviceId);
    if (!selected) {
      toast.error("Selecione um serviço ativo do catálogo.");
      return;
    }
    if (drafts.some((draft) => draft.serviceId === serviceId)) {
      toast.info("Este serviço já está na seleção.");
      return;
    }
    setDrafts((current) => [
      ...current,
      {
        key: newCommandKey(),
        serviceId: selected.id,
        purchaseType: "SINGLE",
        sessionCount: "10",
        priceRaw: (selected.defaultPriceCents / 100).toFixed(2).replace(".", ","),
        notes: "",
        performedSessionDates: [],
      },
    ]);
    setServiceToAddId("");
  }

  function updateDraft(key: string, patch: Partial<Omit<ServiceDraft, "key" | "serviceId">>) {
    setDrafts((current) =>
      current.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)),
    );
  }

  function applyEnvelope(envelope: OfficeFinanceExtractionEnvelope) {
    envelope.warnings.forEach((warning) => toast.warning(warning, { duration: 7000 }));
    if (envelope.model.recordType !== "patient_sale") {
      toast.error("A informação não foi reconhecida como serviço ou plano para o paciente.");
      return;
    }
    if (envelope.resolvedPatientId && envelope.resolvedPatientId !== patientId) {
      toast.warning(
        `A mídia menciona outro paciente. O registro continuará fixado em ${patientName}; revise antes de confirmar.`,
        { duration: 8000 },
      );
    }

    const dates = envelope.suggestedPerformedSessionYyyyMmDd;
    if (envelope.suggestedSaleAction === "mark_sessions_done") {
      if (dates.length === 0) {
        toast.error("Não foi possível reconhecer as datas das sessões a marcar como realizadas.");
        return;
      }
      const withPending = purchases.filter((row) => row.pendingCount > 0);
      if (withPending.length === 0) {
        toast.error("Este paciente não tem sessões pendentes em planos existentes.");
        return;
      }
      const resolvedService = envelope.resolvedProfessionalServiceId
        ? activeServices.find((service) => service.id === envelope.resolvedProfessionalServiceId)
        : null;
      const serviceName = resolvedService?.name?.toLowerCase() ?? "";
      const matched = serviceName
        ? withPending.find((row) =>
            row.purchase.serviceName.toLowerCase().includes(serviceName) ||
            serviceName.includes(row.purchase.serviceName.toLowerCase()),
          )
        : null;
      const chosen = matched ?? withPending[0]!;
      setDrafts([]);
      setSessionUpdateDraft({
        purchaseId: chosen.purchase.id,
        dates,
        summary: envelope.model.narrativeSummaryPt ?? null,
      });
      toast.success(
        `Pronto para marcar ${dates.length} sessão(ões) como realizadas em «${chosen.purchase.serviceName}». Confirme abaixo.`,
      );
      return;
    }

    setSessionUpdateDraft(null);
    const resolvedService = envelope.resolvedProfessionalServiceId
      ? activeServices.find(
          (service) => service.id === envelope.resolvedProfessionalServiceId,
        )
      : null;
    const targetServiceId = resolvedService?.id ?? drafts[0]?.serviceId;
    if (!targetServiceId) {
      toast.error("Selecione ao menos um serviço antes de aplicar o rascunho.");
      return;
    }
    const type = envelope.model.purchaseTypeGuess ?? "SINGLE";
    setDrafts((current) => {
      const hasTarget = current.some((draft) => draft.serviceId === targetServiceId);
      const base = hasTarget
        ? current
        : [
            ...current,
            {
              key: newCommandKey(),
              serviceId: targetServiceId,
              purchaseType: "SINGLE" as const,
              sessionCount: "10",
              priceRaw: ((resolvedService?.defaultPriceCents ?? 0) / 100)
                .toFixed(2)
                .replace(".", ","),
              notes: "",
              performedSessionDates: [],
            },
          ];
      return base.map((draft) =>
        draft.serviceId === targetServiceId
          ? {
              ...draft,
              purchaseType: type,
              ...(envelope.suggestedAgreedPriceCents != null
                ? {
                    priceRaw: (envelope.suggestedAgreedPriceCents / 100)
                      .toFixed(2)
                      .replace(".", ","),
                  }
                : {}),
              ...(type === "PACKAGE" && envelope.model.packageSessionsGuess
                ? { sessionCount: String(envelope.model.packageSessionsGuess) }
                : {}),
              ...(() => {
                const paymentNote = envelope.suggestedPaymentNote;
                const narrative = envelope.model.narrativeSummaryPt?.trim() || "";
                const parts = [narrative, paymentNote].filter(Boolean) as string[];
                if (parts.length === 0) return {};
                const merged = parts.join(parts.length > 1 ? " · " : "");
                return { notes: merged };
              })(),
              ...(envelope.suggestedPerformedSessionYyyyMmDd.length > 0
                ? { performedSessionDates: envelope.suggestedPerformedSessionYyyyMmDd }
                : {}),
            }
          : draft,
      );
    });
    if (envelope.model.registerSalePaymentGuess != null) {
      setRegisterPayment(envelope.model.registerSalePaymentGuess);
    } else if (envelope.model.paymentMethodGuess) {
      // Forma de pagamento citada no áudio → assume recebimento já feito.
      setRegisterPayment(true);
    }
    if (envelope.model.paymentMethodGuess) {
      setPaymentMethod(envelope.model.paymentMethodGuess);
    }
    if (envelope.suggestedInstallmentCount != null) {
      setInstallmentCount(String(envelope.suggestedInstallmentCount));
    }
    if (envelope.suggestedOccurredYyyyMmDd) {
      setPaymentDate(envelope.suggestedOccurredYyyyMmDd);
    }
    const performedN = envelope.suggestedPerformedSessionYyyyMmDd.length;
    toast.success(
      performedN > 0
        ? `Rascunho preenchido com ${performedN} sessão(ões) já realizada(s). Revise antes de registrar.`
        : "Rascunho preenchido. Revise antes de registrar.",
    );
  }


  async function confirmSessionUpdate() {
    if (!sessionUpdateDraft) return;
    setBusy(true);
    try {
      const result = await consumePatientPurchaseSessionsByDates({
        purchaseId: sessionUpdateDraft.purchaseId,
        dates: sessionUpdateDraft.dates,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      const { consumed, skipped } = result.data ?? { consumed: 0, skipped: 0 };
      toast.success(
        skipped > 0
          ? `${consumed} sessão(ões) marcadas; ${skipped} data(s) sem sessão pendente restante.`
          : `${consumed} sessão(ões) marcadas como realizadas.`,
      );
      setSessionUpdateDraft(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

    async function submitPurchase(event: React.FormEvent) {
    event.preventDefault();
    if (drafts.length === 0) {
      toast.error("Adicione ao menos um serviço do catálogo.");
      return;
    }
    const prepared = drafts.map((draft) => ({
      draft,
      cents: rawMoneyToCents(draft.priceRaw),
      sessions:
        draft.purchaseType === "PACKAGE" ? Number(draft.sessionCount) || 0 : 1,
    }));
    const invalid = prepared.find(
      ({ draft, cents, sessions }) =>
        cents == null ||
        cents <= 0 ||
        (draft.purchaseType === "PACKAGE" && (sessions < 2 || sessions > 200)),
    );
    if (invalid) {
      toast.error("Revise o valor e a quantidade de sessões dos serviços selecionados.");
      return;
    }
    if (registerPayment && paymentMethod === "CARD" && installmentCount.trim()) {
      const probe = resolveCardInstallmentFromForm({
        baseAmountCents: prepared[0]!.cents!,
        installmentCountRaw: installmentCount,
        interestMode,
        interestPercentRaw,
      });
      if (!probe.ok) {
        toast.error(probe.error);
        return;
      }
    }

    if (registerPayment && paymentMethod === "CARD" && interestMode === "with") {
      const samples = prepared.map(({ cents }) => {
        const r = resolveCardInstallmentFromForm({
          baseAmountCents: cents!,
          installmentCountRaw: installmentCount,
          interestMode,
          interestPercentRaw,
        });
        return r.ok && r.plan ? r.plan.totalCents : cents!;
      });
      const baseSum = prepared.reduce((a, p) => a + (p.cents ?? 0), 0);
      const chargeSum = samples.reduce((a, c) => a + c, 0);
      if (chargeSum !== baseSum) {
        const ok = window.confirm(
          `Total a registrar no caixa: R$ ${(chargeSum / 100).toFixed(2).replace(".", ",")} (catálogo R$ ${(baseSum / 100).toFixed(2).replace(".", ",")} + juros). Confirmar?`,
        );
        if (!ok) return;
      }
    }

    setBusy(true);
    try {
      for (const { draft, cents, sessions } of prepared) {
        let chargeCents = cents;
        let paymentNote: string | null = null;

        if (registerPayment && paymentMethod === "CARD") {
          const resolved = resolveCardInstallmentFromForm({
            baseAmountCents: cents,
            installmentCountRaw: installmentCount,
            interestMode,
            interestPercentRaw,
          });
          if (!resolved.ok) {
            toast.error(resolved.error);
            return;
          }
          if (resolved.plan) {
            chargeCents = resolved.plan.totalCents;
            paymentNote = resolved.notes;
          } else {
            paymentNote = formatPaymentNotes({
              method: "CARD",
              cardKind: "CREDIT",
              installmentCount: null,
            });
          }
        } else if (registerPayment) {
          paymentNote = formatPaymentNotes({
            method: paymentMethod,
            cardKind: null,
            installmentCount: null,
          });
        }

        const notesMerged = [draft.notes?.trim(), paymentNote]
          .filter(Boolean)
          .filter((v, i, a) => a.indexOf(v) === i)
          .join(" · ");

        const preConsumed =
          draft.performedSessionDates.length > 0
            ? draft.performedSessionDates
                .map((ymd) => {
                  const at = yyyyMmDdToSaoPauloNoon(ymd);
                  return at ? { consumedAt: at } : null;
                })
                .filter((x): x is { consumedAt: Date } => Boolean(x))
            : undefined;

        const paymentAt = registerPayment
          ? yyyyMmDdToSaoPauloNoon(paymentDate) ?? new Date(`${paymentDate}T12:00:00-03:00`)
          : undefined;

        const catalogService = services.find((service) => service.id === draft.serviceId);
        const result = await createPatientPurchase({
          patientId,
          professionalServiceId: draft.serviceId,
          type:
            catalogService?.billingMode === "MONTHLY" ? "SINGLE" : draft.purchaseType,
          billingMode:
            catalogService?.billingMode === "MONTHLY" ? "MONTHLY" : "SESSION",
          sessionCountTotal:
            catalogService?.billingMode === "MONTHLY" ? 1 : sessions,
          agreedPriceCents: cents,
          ...(chargeCents !== cents ? { paymentAmountCents: chargeCents } : {}),
          notes: notesMerged || undefined,
          registerIncomePayment: registerPayment,
          paymentMethod: registerPayment ? paymentMethod : undefined,
          paymentOccurredAt: paymentAt,
          paymentDescription: paymentNote ?? undefined,
          idempotencyKey: draft.key,
          // Omitir = herdar do serviço no server; id explícito sobrescreve.
          ...(saleSpaceId.trim() ? { serviceSpaceId: saleSpaceId.trim() } : {}),
          ...(preConsumed &&
          preConsumed.length > 0 &&
          catalogService?.billingMode !== "MONTHLY"
            ? { preConsumedSessions: preConsumed }
            : {}),
        });
        if (!result.success) {
          const serviceName = catalogService?.name ?? "Serviço";
          toast.error(`${serviceName}: ${result.error}`);
          await load();
          return;
        }
      }
      toast.success(
        drafts.length === 1
          ? registerPayment
            ? "Serviço vinculado e entrada registrada no Financeiro."
            : "Serviço vinculado ao paciente (pagamento pendente — registre a entrada no Financeiro)."
          : registerPayment
            ? `${drafts.length} serviços vinculados com entradas no Financeiro.`
            : `${drafts.length} serviços vinculados (pagamento pendente no caixa).`,
      );
      dismissPlanReminder();
      setDrafts([]);
      setServiceToAddId("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function consumeSession(sessionId: string) {
    const selectedDate = sessionDates[sessionId] ?? todayInput();
    const consumedAt =
      yyyyMmDdToSaoPauloNoon(selectedDate) ?? new Date(`${selectedDate}T12:00:00-03:00`);
    setBusy(true);
    try {
      const result = await consumeServiceSessionManual({
        sessionId,
        consumedAt,
      });
      if (!result.success) {
        toast.error(result.error);
        // Recarrega mesmo em falha (timeout) para limpar estado stale na UI.
        await load();
        return;
      }
      const nearEnd = result.data?.sessionConsumption
        ? formatPackageNearEndWarning(result.data.sessionConsumption)
        : null;
      if (nearEnd) {
        toast.warning(nearEnd, { duration: 10_000 });
      } else {
        toast.success("Sessão marcada como realizada na data informada.");
      }
      setSessionDates((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  function openCollectPayment(row: PurchasesResult[number]) {
    setCollectingPurchaseId(row.purchase.id);
    setCollectMethod("PIX");
    setCollectInstallmentCount("");
    setCollectInterestMode("none");
    setCollectInterestPercentRaw("");
    setCollectDate(todayInput());
    setCollectPriceRaw(
      row.purchase.agreedPriceCents > 0
        ? (row.purchase.agreedPriceCents / 100).toFixed(2).replace(".", ",")
        : "",
    );
  }

  async function submitCollectPayment(row: PurchasesResult[number]) {
    if (row.hasIncomePayment) {
      toast.info("Esta compra já está paga no caixa.");
      setCollectingPurchaseId(null);
      return;
    }
    const cents = rawMoneyToCents(collectPriceRaw);
    if (cents == null || cents <= 0) {
      toast.error("Informe um valor válido para o recebimento.");
      return;
    }

    let chargeCents = cents;
    let paymentNote: string | null = null;
    if (collectMethod === "CARD") {
      const resolved = resolveCardInstallmentFromForm({
        baseAmountCents: cents,
        installmentCountRaw: collectInstallmentCount,
        interestMode: collectInterestMode,
        interestPercentRaw: collectInterestPercentRaw,
      });
      if (!resolved.ok) {
        toast.error(resolved.error);
        return;
      }
      if (resolved.plan) {
        chargeCents = resolved.plan.totalCents;
        paymentNote = resolved.notes;
      } else {
        paymentNote = formatPaymentNotes({
          method: "CARD",
          cardKind: "CREDIT",
          installmentCount: null,
        });
      }
    }

    if (chargeCents !== cents) {
      const ok = window.confirm(
        `Total no caixa: R$ ${(chargeCents / 100).toFixed(2).replace(".", ",")} (valor da compra R$ ${(cents / 100).toFixed(2).replace(".", ",")} + juros). Confirmar?`,
      );
      if (!ok) return;
    }

    setBusy(true);
    try {
      const description = [
        `Recebimento — ${row.purchase.serviceName}`,
        paymentNote,
      ]
        .filter(Boolean)
        .join(" · ");
      const result = await createFinancialTransaction({
        kind: "INCOME",
        amountCents: chargeCents,
        occurredAt:
          yyyyMmDdToSaoPauloNoon(collectDate) ??
          new Date(`${collectDate}T12:00:00-03:00`),
        method: collectMethod,
        patientId,
        purchaseId: row.purchase.id,
        description,
        source: "MANUAL",
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Entrada registrada no Financeiro e vinculada à compra.");
      setCollectingPurchaseId(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <PremiumFeatureTeaserCard
      featureId="office-finance"
      allowed={financePlan?.canUseOfficeFinance === true}
      pending={financePlan === null}
    >
    <Card className="border-border bg-white shadow-sm dark:bg-card">
      <CardHeader>
        <CardTitle>Serviços e plano de tratamento</CardTitle>
        <CardDescription>
          Vincule serviços do catálogo a {patientName}. O mesmo registro alimenta o
          Financeiro, a Agenda e o controle de sessões.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {purchases.filter((r) => !r.hasIncomePayment).length > 0 &&
          canManagePatientServices && (
          <div
            className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground"
            role="status"
          >
            <p className="font-medium">
              {purchases.filter((r) => !r.hasIncomePayment).length} compra(s) com pagamento
              pendente
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Registre o recebimento abaixo ou veja o lembrete no{" "}
              <Link
                href={buildFinanceDeepLink({
                  tab: "analisar",
                  action: "pending",
                  patientId,
                })}
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                Financeiro
              </Link>
              .
            </p>
          </div>
        )}
        {canManagePatientServices && planReminder ? (
          <div
            className="relative rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 pr-10 text-sm text-foreground"
            role="status"
          >
            <button
              type="button"
              className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground hover:bg-warning/20 hover:text-foreground"
              aria-label="Fechar lembrete"
              onClick={dismissPlanReminder}
            >
              <X className="h-4 w-4" />
            </button>
            <p className="font-medium">Lembrete da evolução</p>
            <p className="mt-1 text-muted-foreground">
              Foi mencionado que {patientName} contratou{" "}
              {planReminder.purchaseType === "PACKAGE" || (planReminder.sessionCount ?? 0) >= 2
                ? `um plano${planReminder.sessionCount ? ` de ${planReminder.sessionCount} sessões` : ""}`
                : "um serviço"}
              {planReminder.serviceNameHint
                ? ` («${planReminder.serviceNameHint}»)`
                : ""}
              , mas o catálogo ainda não tinha match. Cadastre/selecione o serviço abaixo e
              salve o vínculo para liberar a Agenda.
            </p>
            {activeServices.length === 0 ? (
              <p className="mt-2">
                <Link
                  href="/dashboard/finances"
                  className="font-medium text-foreground underline underline-offset-2"
                >
                  Abrir Financeiro para cadastrar o serviço
                </Link>
              </p>
            ) : null}
          </div>
        ) : null}

        {!canManagePatientServices ? (
          <div
            className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
            role="status"
          >
            Seu perfil de membro não tem permissão para cadastrar planos ou baixar sessões
            nesta ficha. Peça ao administrador da clínica para liberar em{" "}
            <span className="font-medium text-foreground">Meu Perfil → Equipe</span>.
          </div>
        ) : null}

        {canManagePatientServices && financePlan && (
          <FinanceFormIntakeToolbar
            target="purchase"
            allowText
            allowImageUpload={financePlan.officeFinanceAllowsImageUpload}
            maxAudioMinutes={financePlan.maxAudioMinutes}
            disabled={busy}
            hint="Áudio/texto: criar plano novo OU marcar sessões já feitas (ex.: «marcar como realizadas 08 e 16 de julho» ou «realizou nos dias 07, 09, 14… de julho»). Só preenche rascunho."
            onEnvelope={applyEnvelope}
          />
        )}

        {canManagePatientServices && sessionUpdateDraft ? (
          <div className="rounded-lg border border-clinical/40 bg-clinical/5 p-4 text-sm">
            <p className="font-medium text-foreground">Atualizar sessões de plano existente</p>
            <p className="mt-1 text-muted-foreground">
              O áudio pediu para marcar sessões já realizadas — nada será salvo sem sua confirmação.
            </p>
            {sessionUpdateDraft.summary ? (
              <p className="mt-2 text-xs text-muted-foreground">{sessionUpdateDraft.summary}</p>
            ) : null}
            <div className="mt-3 space-y-2">
              <Label htmlFor="session-update-purchase">Plano / pacote</Label>
              <select
                id="session-update-purchase"
                className="flex h-10 w-full rounded-md border border-border bg-white px-3 text-sm dark:bg-card"
                value={sessionUpdateDraft.purchaseId}
                onChange={(event) =>
                  setSessionUpdateDraft((current) =>
                    current ? { ...current, purchaseId: event.target.value } : current,
                  )
                }
                disabled={busy}
              >
                {purchases
                  .filter((row) => row.pendingCount > 0)
                  .map((row) => (
                    <option key={row.purchase.id} value={row.purchase.id}>
                      {row.purchase.serviceName} · {row.pendingCount} pendente(s)
                    </option>
                  ))}
              </select>
            </div>
            <ul className="mt-3 space-y-2 text-muted-foreground">
              {sessionUpdateDraft.dates.map((ymd) => {
                const [y, m, d] = ymd.split("-");
                const label = y && m && d ? `${d}/${m}/${y}` : ymd;
                return (
                  <li key={ymd} className="flex flex-wrap items-center gap-2">
                    <span>{label}</span>
                    <button
                      type="button"
                      className="text-xs text-destructive underline"
                      disabled={busy}
                      onClick={() =>
                        setSessionUpdateDraft((current) =>
                          current
                            ? {
                                ...current,
                                dates: current.dates.filter((x) => x !== ymd),
                              }
                            : current,
                        )
                      }
                    >
                      Remover
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1">
                <Label htmlFor="session-update-add-date">Adicionar / corrigir data</Label>
                <Input
                  id="session-update-add-date"
                  type="date"
                  max={todayInput()}
                  disabled={busy}
                  onChange={(event) => {
                    const ymd = event.target.value;
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return;
                    setSessionUpdateDraft((current) => {
                      if (!current) return current;
                      if (current.dates.includes(ymd)) return current;
                      return { ...current, dates: [...current.dates, ymd].sort() };
                    });
                    event.target.value = "";
                  }}
                />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={busy || sessionUpdateDraft.dates.length === 0}
                onClick={() => void confirmSessionUpdate()}
              >
                Confirmar sessões realizadas
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setSessionUpdateDraft(null)}
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : null}

        {canManagePatientServices ? (
        <form onSubmit={submitPurchase} className="space-y-5">
          <ServiceSpaceSelect
            id="patient-sale-space"
            value={saleSpaceId}
            onChange={(id) => {
              setSaleSpaceId(id);
              setServiceToAddId("");
            }}
            label="Espaço desta venda"
          />
          <div>
            <Label htmlFor="patient-service">Serviços disponíveis no catálogo</Label>
            <div className="mt-1 flex flex-col gap-2 sm:flex-row">
              <select
                id="patient-service"
                className="flex h-10 min-w-0 flex-1 rounded-md border border-border bg-white px-3 text-sm dark:bg-card"
                value={serviceToAddId}
                onChange={(event) => setServiceToAddId(event.target.value)}
                disabled={loading || activeServices.length === 0}
              >
                <option value="">
                  {loading
                    ? "Carregando catálogo…"
                    : activeServices.length === 0
                      ? "Nenhum serviço neste espaço"
                      : "Selecione um serviço"}
                </option>
                {activeServices.map((service) => {
                  const alreadySelected = drafts.some(
                    (draft) => draft.serviceId === service.id,
                  );
                  return (
                    <option
                      key={service.id}
                      value={service.id}
                      disabled={alreadySelected}
                    >
                      {service.name} · {formatBrlFromCents(service.defaultPriceCents)}
                      {alreadySelected ? " (já selecionado)" : ""}
                    </option>
                  );
                })}
              </select>
              <Button
                type="button"
                variant="outline"
                disabled={!serviceToAddId || busy}
                onClick={() => addServiceToSelection()}
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden />
                Adicionar à seleção
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              O catálogo é somente leitura nesta ficha. Você pode selecionar mais de um
              serviço antes de confirmar.
            </p>
            {activeServices.length === 0 && !loading && (
              <div className="mt-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Nenhum serviço ativo no catálogo.{" "}
                <Link
                  href="/dashboard/finances?tab=catalogo"
                  className="font-medium text-clinical underline"
                >
                  Abrir o Catálogo no Financeiro
                </Link>
              </div>
            )}
          </div>

          {drafts.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">
                Serviços que serão vinculados ({drafts.length})
              </h3>
              {drafts.map((draft, index) => {
                const service = services.find(
                  (candidate) => candidate.id === draft.serviceId,
                );
                return (
                  <div
                    key={draft.key}
                    className="rounded-lg border border-border bg-muted/20 p-4"
                  >
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">
                          {index + 1}. {service?.name ?? "Serviço"}
                        </p>
                        {service?.description && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {service.description}
                          </p>
                        )}
                        {service?.billingMode === "MONTHLY" ? (
                          <p className="mt-1 text-xs text-clinical">
                            Mensalidade — vigência no mês civil; o aviso de renovação aparece no meio
                            do período (não por sessões restantes).
                          </p>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Remover ${service?.name ?? "serviço"} da seleção`}
                        disabled={busy}
                        onClick={() =>
                          setDrafts((current) =>
                            current.filter((item) => item.key !== draft.key),
                          )
                        }
                      >
                        <X className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <Label htmlFor={`patient-service-price-${draft.key}`}>
                          Valor combinado (R$)
                        </Label>
                        <Input
                          id={`patient-service-price-${draft.key}`}
                          inputMode="decimal"
                          value={draft.priceRaw}
                          onChange={(event) =>
                            updateDraft(draft.key, { priceRaw: event.target.value })
                          }
                        />
                      </div>
                      {service?.billingMode === "MONTHLY" ? (
                        <div className="flex items-center pt-6 text-sm text-muted-foreground">
                          Modalidade: mensalidade
                        </div>
                      ) : (
                      <div className="flex items-center gap-4 pt-6">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="radio"
                            name={`patientPurchaseType-${draft.key}`}
                            checked={draft.purchaseType === "SINGLE"}
                            onChange={() =>
                              updateDraft(draft.key, { purchaseType: "SINGLE" })
                            }
                          />
                          Serviço avulso
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="radio"
                            name={`patientPurchaseType-${draft.key}`}
                            checked={draft.purchaseType === "PACKAGE"}
                            onChange={() =>
                              updateDraft(draft.key, { purchaseType: "PACKAGE" })
                            }
                          />
                          Plano/pacote
                        </label>
                      </div>
                      )}
                      {draft.purchaseType === "PACKAGE" &&
                        service?.billingMode !== "MONTHLY" && (
                        <div>
                          <Label htmlFor={`patient-service-sessions-${draft.key}`}>
                            Total de sessões/atendimentos
                          </Label>
                          <Input
                            id={`patient-service-sessions-${draft.key}`}
                            type="number"
                            min={2}
                            max={200}
                            value={draft.sessionCount}
                            onChange={(event) =>
                              updateDraft(draft.key, {
                                sessionCount: event.target.value,
                              })
                            }
                          />
                        </div>
                      )}
                      <div
                        className={
                          draft.purchaseType === "PACKAGE" ? "" : "md:col-span-2"
                        }
                      >
                        <Label htmlFor={`patient-service-notes-${draft.key}`}>
                          Observações
                        </Label>
                        <Textarea
                          id={`patient-service-notes-${draft.key}`}
                          value={draft.notes}
                          onChange={(event) =>
                            updateDraft(draft.key, { notes: event.target.value })
                          }
                          rows={2}
                        />
                      </div>
                      {draft.purchaseType === "PACKAGE" ? (
                        <div className="md:col-span-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
                          <p className="font-medium text-foreground">
                            Sessões já realizadas (opcional)
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Do áudio ou manualmente: ao confirmar o plano, estas datas nascem
                            marcadas como realizadas.
                          </p>
                          {draft.performedSessionDates.length > 0 ? (
                            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                              {draft.performedSessionDates.map((ymd) => {
                                const [y, m, d] = ymd.split("-");
                                const label =
                                  y && m && d ? `${d}/${m}/${y}` : ymd;
                                return (
                                  <li
                                    key={ymd}
                                    className="flex flex-wrap items-center gap-2"
                                  >
                                    <span>{label}</span>
                                    <button
                                      type="button"
                                      className="text-xs text-destructive underline"
                                      onClick={() =>
                                        updateDraft(draft.key, {
                                          performedSessionDates:
                                            draft.performedSessionDates.filter(
                                              (x) => x !== ymd,
                                            ),
                                        })
                                      }
                                    >
                                      Remover
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : (
                            <p className="mt-2 text-xs text-muted-foreground">
                              Nenhuma data ainda — todas as sessões ficarão pendentes.
                            </p>
                          )}
                          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                            <div className="flex-1">
                              <Label htmlFor={`add-performed-${draft.key}`}>
                                Data da sessão
                              </Label>
                              <Input
                                id={`add-performed-${draft.key}`}
                                type="date"
                                max={todayInput()}
                                value={draftPerformedDateToAdd}
                                onChange={(event) =>
                                  setDraftPerformedDateToAdd(event.target.value)
                                }
                              />
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              disabled={!draftPerformedDateToAdd}
                              onClick={() => {
                                const ymd = draftPerformedDateToAdd;
                                if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return;
                                if (draft.performedSessionDates.includes(ymd)) {
                                  toast.info("Essa data já está na lista.");
                                  return;
                                }
                                const next = [...draft.performedSessionDates, ymd].sort();
                                updateDraft(draft.key, { performedSessionDates: next });
                              }}
                            >
                              Adicionar data realizada
                            </Button>
                          </div>
                          {draft.performedSessionDates.length > 0 ? (
                            <button
                              type="button"
                              className="mt-2 text-xs text-clinical underline"
                              onClick={() =>
                                updateDraft(draft.key, { performedSessionDates: [] })
                              }
                            >
                              Limpar datas realizadas (deixar todas pendentes)
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {drafts.length > 0 && (
            <div className="grid gap-4 border-t pt-4 md:grid-cols-2">
              <label className="flex items-center gap-2 text-sm md:col-span-2">
                <input
                  type="checkbox"
                  checked={registerPayment}
                  onChange={(event) => setRegisterPayment(event.target.checked)}
                />
                Pagamento já recebido — registrar uma entrada para cada serviço
              </label>
              {registerPayment && (
                <>
                  <div>
                    <Label htmlFor="patient-service-method">Forma de pagamento</Label>
                    <select
                      id="patient-service-method"
                      className="flex h-10 w-full rounded-md border border-border bg-white px-3 text-sm dark:bg-card"
                      value={paymentMethod}
                      onChange={(event) => {
                        const next = event.target.value as FinancialTransactionMethod;
                        setPaymentMethod(next);
                        if (next !== "CARD") {
                          setInstallmentCount("");
                          setInterestMode("none");
                          setInterestPercentRaw("");
                        }
                      }}
                    >
                      {Object.entries(METHOD_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {paymentMethod === "CARD" ? (
                    <CardInstallmentOptions
                      idPrefix="patient-service"
                      installmentCount={installmentCount}
                      onInstallmentCountChange={setInstallmentCount}
                      interestMode={interestMode}
                      onInterestModeChange={setInterestMode}
                      interestPercentRaw={interestPercentRaw}
                      onInterestPercentRawChange={setInterestPercentRaw}
                      baseAmountCents={drafts.reduce((acc, draft) => {
                        const c = rawMoneyToCents(draft.priceRaw);
                        return c != null && c > 0 ? acc + c : acc;
                      }, 0) || null}
                    />
                  ) : null}
                  <div>
                    <Label htmlFor="patient-service-payment-date">Data do recebimento</Label>
                    <Input
                      id="patient-service-payment-date"
                      type="date"
                      value={paymentDate}
                      onChange={(event) => setPaymentDate(event.target.value)}
                    />
                  </div>
                </>
              )}
              <div className="md:col-span-2">
                <Button type="submit" disabled={busy}>
                  {busy
                    ? "Registrando…"
                    : drafts.length === 1
                      ? "Vincular serviço ao paciente"
                      : `Vincular ${drafts.length} serviços ao paciente`}
                </Button>
              </div>
            </div>
          )}
        </form>
        ) : null}

        <div className="border-t pt-5">
          <h3 className="font-semibold">Histórico e sessões</h3>
          {purchases
            ?.filter(
              (row) =>
                row.purchase.billingMode === "MONTHLY" &&
                row.purchase.periodStart &&
                row.purchase.periodEnd &&
                isMonthlyPlanMidPeriod({
                  periodStart: new Date(row.purchase.periodStart),
                  periodEnd: new Date(row.purchase.periodEnd),
                }),
            )
            .map((row) => (
              <p
                key={`mid-month-${row.purchase.id}`}
                className="mt-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground"
              >
                {formatMonthlyMidPeriodWarning({
                  patientName,
                  serviceName: row.purchase.serviceName,
                  periodEnd: row.purchase.periodEnd
                    ? new Date(row.purchase.periodEnd)
                    : null,
                })}
              </p>
            ))}
          {purchases
            ?.filter(
              (row) =>
                row.purchase.type === "PACKAGE" &&
                row.purchase.billingMode !== "MONTHLY" &&
                isPackageApproachingEnd({
                  pendingRemaining: row.pendingCount,
                  sessionCount: row.purchase.sessionCountTotal,
                }),
            )
            .map((row) => {
              const warn = formatPackageNearEndWarning({
                pendingRemaining: row.pendingCount,
                sessionCount: row.purchase.sessionCountTotal,
                serviceName: row.purchase.serviceName,
                patientName,
              });
              if (!warn) return null;
              return (
                <p
                  key={`near-end-${row.purchase.id}`}
                  className="mt-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground"
                >
                  {warn}
                </p>
              );
            })}
          {highlightSessionId &&
            purchases.some((row) =>
              row.sessions.some((s) => s.id === highlightSessionId && s.status === "CONSUMED"),
            ) && (
              <p className="mt-2 rounded-md border border-clinical/30 bg-clinical/5 px-3 py-2 text-sm text-foreground">
                A última evolução baixou automaticamente a sessão destacada abaixo, na data do
                atendimento.
              </p>
            )}
          {loading ? (
            <p className="mt-2 text-sm text-muted-foreground">Carregando serviços…</p>
          ) : !purchases?.length ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Nenhum serviço vinculado a este paciente.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {purchases.map((row) => (
                <li key={row.purchase.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{row.purchase.serviceName}</span>
                    <Badge variant="outline">
                      {row.purchase.billingMode === "MONTHLY"
                        ? "Mensalidade"
                        : row.purchase.type === "SINGLE"
                          ? "Avulso"
                          : "Plano/pacote"}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {formatBrlFromCents(row.purchase.agreedPriceCents)}
                    </span>
                    <Badge variant="outline">
                      {row.hasIncomePayment ? "Pago no caixa" : "Pagamento pendente"}
                    </Badge>
                    {!row.hasIncomePayment &&
                      canManagePatientServices &&
                      collectingPurchaseId !== row.purchase.id && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-7"
                        disabled={busy}
                        onClick={() => openCollectPayment(row)}
                      >
                        Registrar pagamento
                      </Button>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.consumedCount} de {row.sessions.length} realizada(s) ·{" "}
                    {row.pendingCount} pendente(s) ·{" "}
                    {new Date(row.purchase.purchasedAt).toLocaleDateString("pt-BR")}
                  </p>
                  {!row.hasIncomePayment &&
                    canManagePatientServices &&
                    collectingPurchaseId === row.purchase.id && (
                    <div className="mt-3 space-y-3 rounded-md border border-dashed border-border bg-muted/40 p-3">
                      <p className="text-xs text-muted-foreground">
                        Registra uma entrada no Financeiro ligada a esta
                        compra — não cria nova venda nem altera sessões.
                      </p>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <Label htmlFor={`collect-price-${row.purchase.id}`}>
                            Valor (R$)
                          </Label>
                          <Input
                            id={`collect-price-${row.purchase.id}`}
                            inputMode="decimal"
                            value={collectPriceRaw}
                            onChange={(event) => setCollectPriceRaw(event.target.value)}
                          />
                        </div>
                        <div>
                          <Label htmlFor={`collect-method-${row.purchase.id}`}>
                            Forma
                          </Label>
                          <select
                            id={`collect-method-${row.purchase.id}`}
                            className="flex h-10 w-full rounded-md border border-border bg-white px-3 text-sm dark:bg-card"
                            value={collectMethod}
                            onChange={(event) => {
                              const next = event.target.value as FinancialTransactionMethod;
                              setCollectMethod(next);
                              if (next !== "CARD") {
                                setCollectInstallmentCount("");
                                setCollectInterestMode("none");
                                setCollectInterestPercentRaw("");
                              }
                            }}
                          >
                            {Object.entries(METHOD_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <Label htmlFor={`collect-date-${row.purchase.id}`}>Data</Label>
                          <Input
                            id={`collect-date-${row.purchase.id}`}
                            type="date"
                            max={todayInput()}
                            value={collectDate}
                            onChange={(event) => setCollectDate(event.target.value)}
                          />
                        </div>
                      </div>
                      {collectMethod === "CARD" ? (
                        <CardInstallmentOptions
                          idPrefix={`collect-${row.purchase.id}`}
                          installmentCount={collectInstallmentCount}
                          onInstallmentCountChange={setCollectInstallmentCount}
                          interestMode={collectInterestMode}
                          onInterestModeChange={setCollectInterestMode}
                          interestPercentRaw={collectInterestPercentRaw}
                          onInterestPercentRawChange={setCollectInterestPercentRaw}
                          baseAmountCents={rawMoneyToCents(collectPriceRaw)}
                        />
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={busy}
                          onClick={() => void submitCollectPayment(row)}
                        >
                          {busy ? "Registrando…" : "Confirmar no caixa"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setCollectingPurchaseId(null)}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  )}
                  <div className="mt-3 space-y-2">
                    {row.sessions.map((session) => (
                      <div
                        key={session.id}
                        className={
                          session.id === highlightSessionId
                            ? "flex flex-col gap-2 rounded-md border border-clinical/40 bg-clinical/10 px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between"
                            : "flex flex-col gap-2 rounded-md bg-muted px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between"
                        }
                      >
                        <span className="font-medium">
                          Sessão {session.sequence}:{" "}
                          {session.status === "CONSUMED"
                            ? `realizada em ${
                                session.consumedAt
                                  ? new Date(session.consumedAt).toLocaleDateString("pt-BR")
                                  : "data não informada"
                              }`
                            : "pendente"}
                          {session.consumptionSource === "EVOLUTION_RECORDED" ? (
                            <span className="ml-1.5 font-normal text-muted-foreground">
                              · via evolução
                            </span>
                          ) : session.consumptionSource === "APPOINTMENT_COMPLETED" ? (
                            <span className="ml-1.5 font-normal text-muted-foreground">
                              · via agenda
                            </span>
                          ) : null}
                        </span>
                        {session.status === "PENDING" && canManagePatientServices && (
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <Label
                              htmlFor={`session-date-${session.id}`}
                              className="sr-only"
                            >
                              Data da realização da sessão {session.sequence}
                            </Label>
                            <Input
                              id={`session-date-${session.id}`}
                              type="date"
                              max={todayInput()}
                              className="h-8 w-full bg-background text-xs sm:w-40"
                              value={sessionDates[session.id] ?? todayInput()}
                              onChange={(event) =>
                                setSessionDates((current) => ({
                                  ...current,
                                  [session.id]: event.target.value,
                                }))
                              }
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="h-8"
                              disabled={busy}
                              onClick={() => void consumeSession(session.id)}
                            >
                              Marcar realizada
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {!loading && cashEntries.length > 0 ? (
            <div className="mt-6 space-y-2">
              <h4 className="text-sm font-semibold text-foreground">
                Entradas no Financeiro
              </h4>
              <p className="text-xs text-muted-foreground">
                Lançamentos deste paciente no caixa (incluindo entradas feitas em
                Registrar / Analisar). Compras pagas também aparecem acima como «Pago no
                caixa».
              </p>
              <ul className="space-y-2">
                {cashEntries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">
                        {formatBrlFromCents(entry.amountCents)} ·{" "}
                        {METHOD_LABELS[entry.method]}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(entry.occurredAt).toLocaleDateString("pt-BR")}
                        {entry.purchaseServiceName
                          ? ` · ${entry.purchaseServiceName}`
                          : " · Entrada avulsa"}
                        {entry.description ? ` · ${entry.description}` : ""}
                      </p>
                    </div>
                    <Link
                      href={buildFinanceDeepLink({
                        tab: "analisar",
                        patientId,
                      })}
                      className="text-xs text-clinical underline shrink-0"
                    >
                      Ver no Analisar
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
    </PremiumFeatureTeaserCard>
  );
}
