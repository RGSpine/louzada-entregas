"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { PremiumFeatureUpsellScreen } from "@/components/premium/PremiumFeatureUpsellScreen";
import { PREMIUM_FEATURES } from "@/lib/premium-feature-upsell";
import { listLabFinanceClients } from "@/app/actions/logistics";
import {
  consumePatientPurchaseSessionsByDates,
  consumeServiceSessionManual,
  createFinancialTransaction,
  createPatientPurchase,
  listPatientPurchases,
  listProfessionalServices,
  bulkImportProfessionalServices,
  deleteProfessionalService,
  upsertProfessionalService,
  getFinanceAccess,
} from "@/app/actions/clinic-finances";
import { getMyPlanLimits } from "@/app/actions/billing";
import type { OfficeFinanceExtractionEnvelope } from "@/lib/office-finance-ai-extract";
import type { FinancialTransactionKind, FinancialTransactionMethod } from "@prisma/client";
import { FinanceAnalyzePanel } from "@/components/dashboard/finances/FinanceAnalyzePanel";
import { FinanceCatalogPanel } from "@/components/dashboard/finances/FinanceCatalogPanel";
import { FinanceConfigurePanel } from "@/components/dashboard/finances/FinanceConfigurePanel";
import { FinanceRegisterPanel } from "@/components/dashboard/finances/FinanceRegisterPanel";
import { FiscalExportPanel } from "@/components/dashboard/finances/FiscalExportPanel";
import { FinanceTabNav } from "@/components/dashboard/finances/FinanceTabNav";
import {
  FINANCE_TABS,
  type FinanceTabId,
} from "@/components/dashboard/finances/finance-tab-types";
import { toDateInputLocal } from "@/components/dashboard/finances/finance-period-bounds";
import { parseFinanceDeepLink } from "@/lib/finance/finance-deep-link";
import type { FinancePeriodPreset } from "@/lib/finance/period";
import {
  formatPaymentNotes,
  yyyyMmDdToSaoPauloNoon,
} from "@/lib/finance/portuguese-payment";
import {
  type CardInterestMode,
  resolveCardInstallmentFromForm,
} from "@/lib/finance/card-installments";

/** Abas liberadas para MEMBER (clínica): só visualizar catálogo e registrar entradas. */
const MEMBER_FINANCE_TABS: readonly FinanceTabId[] = ["catalogo", "registrar"];

function newPurchaseCommandKey(): string {
  return `finance-sale:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function formatBrlFromCents(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );
}

function rawMoneyToCents(raw: string): number | null {
  const trimmed = raw.replace(/\s/g, "").replace(/[^\d,.-]/g, "");
  if (!trimmed || trimmed === "-") return null;
  const normalized = trimmed.includes(",") ? trimmed.replace(/\./g, "").replace(",", ".") : trimmed;
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100);
}

const METHOD_PT: Record<FinancialTransactionMethod, string> = {
  CASH: "Dinheiro",
  PIX: "PIX",
  CARD: "Cartão",
  TRANSFER: "Transferência",
  OTHER: "Outro",
};

type PatientPurchasesPayload = Exclude<
  Extract<Awaited<ReturnType<typeof listPatientPurchases>>, { success: true }>["data"],
  undefined
>;

function initialPeriodBounds() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start, end: now };
}

export default function FinancesPage() {
  const [planAllowed, setPlanAllowed] = useState<boolean | null>(null);
  const [financeRole, setFinanceRole] = useState<"ADMIN" | "MEMBER" | null>(null);
  const [canManagePatientServices, setCanManagePatientServices] = useState(true);
  const [isTeamPlan, setIsTeamPlan] = useState(false);
  const [financeAccessError, setFinanceAccessError] = useState<string | null>(null);
  /** Só libera painéis de ADMIN após o papel ser confirmado — evita flash de conteúdo privilegiado. */
  const isFinanceAdmin = financeRole === "ADMIN";
  const isFinanceMember = financeRole === "MEMBER";
  const financeRoleReady = financeRole !== null;
  /** Null até o papel ser resolvido — evita aba inválida para o role. */
  const [activeTab, setActiveTab] = useState<FinanceTabId | null>(null);

  /**
   * Navegação de abas respeitando RBAC: MEMBER nunca sai das abas permitidas
   * (painéis de ADMIN não renderizam e a TabNav não teria botão de volta —
   * evita tela em branco quando um fluxo sugere "configurar"/"analisar").
   */
  function goToTab(tab: FinanceTabId, role: "ADMIN" | "MEMBER" | null = financeRole) {
    if (role === "MEMBER" && !MEMBER_FINANCE_TABS.includes(tab)) {
      return;
    }
    setActiveTab(tab);
  }
  const [periodBounds, setPeriodBounds] = useState(initialPeriodBounds);
  const [deepLink, setDeepLink] = useState(() =>
    typeof window !== "undefined"
      ? parseFinanceDeepLink(window.location.search)
      : parseFinanceDeepLink(""),
  );

  const [loadingPatients, setLoadingPatients] = useState(true);
  const [busy, setBusy] = useState(false);
  const [patients, setPatients] = useState<Array<{ id: string; name: string }>>([]);
  const [services, setServices] = useState<
    Array<{
      id: string;
      name: string;
      description: string | null;
      defaultPriceCents: number;
      active: boolean;
      serviceSpaceId: string | null;
      serviceSpaceName: string | null;
      serviceSpaceColor: string | null;
    }>
  >([]);

  const [purchasePatientId, setPurchasePatientId] = useState("");
  const [purchaseServiceId, setPurchaseServiceId] = useState("");
  const [purchaseType, setPurchaseType] = useState<"SINGLE" | "PACKAGE">("SINGLE");
  const [purchasePackageSessions, setPurchasePackageSessions] = useState("10");
  const [purchasePriceRaw, setPurchasePriceRaw] = useState("");
  const [purchaseNotes, setPurchaseNotes] = useState("");
  const [purchasePerformedDates, setPurchasePerformedDates] = useState<string[]>([]);
  const [purchaseCommandKey, setPurchaseCommandKey] = useState(newPurchaseCommandKey);
  const [registerPayment, setRegisterPayment] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState<FinancialTransactionMethod>("PIX");
  const [purchaseInstallmentCount, setPurchaseInstallmentCount] = useState("");
  const [purchaseInterestMode, setPurchaseInterestMode] =
    useState<CardInterestMode>("none");
  const [purchaseInterestPercentRaw, setPurchaseInterestPercentRaw] = useState("");

  const [txKind, setTxKind] = useState<FinancialTransactionKind>("INCOME");
  const [txAmountRaw, setTxAmountRaw] = useState("");
  const [txDateStr, setTxDateStr] = useState(() => toDateInputLocal(new Date()));
  const [txMethod, setTxMethod] = useState<FinancialTransactionMethod>("PIX");
  const [txDescription, setTxDescription] = useState("");
  const [txPatientId, setTxPatientId] = useState("");
  /** Espaço do lançamento avulso (Consultório/Clínica). */
  const [txSpaceId, setTxSpaceId] = useState("");
  /** Espaço da venda no Registrar (filtra catálogo + grava na compra). */
  const [purchaseSpaceId, setPurchaseSpaceId] = useState("");

  const [svcName, setSvcName] = useState("");
  const [svcDesc, setSvcDesc] = useState("");
  const [svcPriceRaw, setSvcPriceRaw] = useState("");
  const [svcSpaceId, setSvcSpaceId] = useState("");
  const [svcBillingMode, setSvcBillingMode] = useState<"SESSION" | "MONTHLY">("SESSION");
  const [editingSvcId, setEditingSvcId] = useState<string | null>(null);
  const [catalogEditorOpen, setCatalogEditorOpen] = useState(false);

  useEffect(() => {
    if (activeTab !== "catalogo") {
      setCatalogEditorOpen(false);
    }
  }, [activeTab]);

  const [financePlan, setFinancePlan] = useState<{
    maxAudioMinutes: number;
    officeFinanceAllowsImageUpload: boolean;
    canUseFinanceAssistant: boolean;
    canUseServiceSpaces: boolean;
  } | null>(null);

  const [purchaseHistory, setPurchaseHistory] = useState<PatientPurchasesPayload | null>(null);
  /** Rascunho de baixa de sessões por áudio — só grava após confirmação humana. */
  const [sessionMarkDraft, setSessionMarkDraft] = useState<{
    patientId: string;
    purchaseId: string;
    dates: string[];
    summary: string | null;
    needsPurchasePick: boolean;
  } | null>(null);
  const [reportReloadKey, setReportReloadKey] = useState(0);

  const bumpReports = useCallback(() => {
    setReportReloadKey((k) => k + 1);
  }, []);

  const loadCatalog = useCallback(async () => {
    const res = await listProfessionalServices();
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    setServices(res.data ?? []);
  }, []);

  const loadPatients = useCallback(async () => {
    setLoadingPatients(true);
    try {
      const res = await listLabFinanceClients();
      if (!res.success) {
        toast.error("Clientes não carregados");
        setPatients([]);
        return;
      }
      setPatients(res.data ?? []);
    } finally {
      setLoadingPatients(false);
    }
  }, []);

  const loadPatientPurchasesPanel = useCallback(async (pid: string) => {
    if (!pid) {
      setPurchaseHistory(null);
      return;
    }
    const res = await listPatientPurchases(pid);
    if (!res.success || !res.data) {
      if (!res.success) toast.error(res.error);
      return;
    }
    setPurchaseHistory(res.data);
  }, []);

  useEffect(() => {
    if (planAllowed !== true) return;
    loadPatients().catch(() => toast.error("Erro ao carregar clientes"));
  }, [loadPatients, planAllowed]);

  useEffect(() => {
    if (planAllowed !== true) return;
    loadCatalog().catch(() => toast.error("Erro ao carregar serviços"));
  }, [loadCatalog, planAllowed]);

  useEffect(() => {
    if (planAllowed !== true) return;
    loadPatientPurchasesPanel(purchasePatientId).catch(() => undefined);
  }, [purchasePatientId, loadPatientPurchasesPanel, planAllowed]);

  useEffect(() => {
    if (!purchasePatientId && patients.length > 0) {
      setPurchasePatientId(patients[0].id);
    }
  }, [purchasePatientId, patients]);

  useEffect(() => {
    if (purchaseServiceId !== "") return;
    const first = services.find((s) => s.active);
    if (!first) return;
    setPurchaseServiceId(first.id);
    setPurchasePriceRaw((first.defaultPriceCents / 100).toFixed(2).replace(".", ","));
  }, [purchaseServiceId, services]);

  useEffect(() => {
    void getMyPlanLimits().then((r) => {
      if (!r.success) {
        setPlanAllowed(false);
        return;
      }
      setPlanAllowed(r.canUseOfficeFinance === true);
      if (!r.limits) return;
      setFinancePlan({
        maxAudioMinutes: r.limits.maxAudioMinutes,
        officeFinanceAllowsImageUpload: r.officeFinanceAllowsImageUpload ?? false,
        canUseFinanceAssistant: r.canUseFinanceAssistant === true,
        canUseServiceSpaces: r.canUseServiceSpaces === true,
      });
    });
  }, []);

  useEffect(() => {
    if (planAllowed !== true) return;
    void getFinanceAccess().then((r) => {
      if (!r.success || !r.data) {
        setFinanceRole(null);
        setActiveTab(null);
        setFinanceAccessError(r.success === false ? r.error : "Não foi possível carregar o acesso financeiro.");
        return;
      }
      setFinanceAccessError(null);
      setFinanceRole(r.data.role);
      setCanManagePatientServices(r.data.canManagePatientServices);
      setIsTeamPlan(r.data.isTeamPlan === true);
      const deep = parseFinanceDeepLink(window.location.search);
      setDeepLink(deep);
      const requestedTab = deep.tab;
      const validRequestedTab = FINANCE_TABS.some((tab) => tab.id === requestedTab)
        ? (requestedTab as FinanceTabId)
        : null;
      const canOpenRequestedTab =
        validRequestedTab &&
        (r.data.role === "ADMIN" || MEMBER_FINANCE_TABS.includes(validRequestedTab));
      // Cobrança de pendência: sempre Analisar (formulário inline) — não Registrar.
      const collectOnAnalyze =
        deep.action === "collect" &&
        Boolean(deep.purchaseId) &&
        (r.data.role === "ADMIN" || r.data.canManagePatientServices);
      setActiveTab(
        collectOnAnalyze
          ? "analisar"
          : canOpenRequestedTab
            ? validRequestedTab
            : r.data.role === "MEMBER"
              ? "registrar"
              : deep.action === "pending"
                ? "analisar"
                : "analisar",
      );
      if (deep.patientId) {
        setPurchasePatientId(deep.patientId);
        setTxPatientId(deep.patientId);
      }
    });
  }, [planAllowed]);

  useEffect(() => {
    if (!financeRole || !activeTab) return;
    if (financeRole === "MEMBER" && !MEMBER_FINANCE_TABS.includes(activeTab)) {
      setActiveTab("registrar");
    }
  }, [financeRole, activeTab]);

  useEffect(() => {
    if (financeRole !== "MEMBER") return;
    setTxKind("INCOME");
  }, [financeRole]);

  const activeServices = services.filter((s) => s.active);
  const registerActiveServices = purchaseSpaceId
    ? activeServices.filter(
        (s) => s.serviceSpaceId === purchaseSpaceId || s.serviceSpaceId == null,
      )
    : activeServices;

  function applyFinanceExtractionEnvelope(env: OfficeFinanceExtractionEnvelope, patientIdFallback: string) {
    env.warnings.forEach((msg) => toast.warning(msg, { duration: 7000 }));

    const m = env.model;
    const meth = (
      guess: FinancialTransactionMethod | undefined | null,
    ): FinancialTransactionMethod | null => {
      if (!guess) return null;
      if (guess in METHOD_PT) return guess as FinancialTransactionMethod;
      return null;
    };

    if (env.suggestedOccurredYyyyMmDd?.match(/^\d{4}-\d{2}-\d{2}$/)) {
      setTxDateStr(env.suggestedOccurredYyyyMmDd);
    }

    const paymentGuess = meth(m.paymentMethodGuess ?? null);
    if (paymentGuess) {
      setPaymentMethod(paymentGuess);
      setTxMethod(paymentGuess);
    }
    if (env.suggestedInstallmentCount != null) {
      setPurchaseInstallmentCount(String(env.suggestedInstallmentCount));
      setPurchaseInterestMode("none");
      setPurchaseInterestPercentRaw("");
    }
    if (env.suggestedPaymentNote) {
      setTxDescription((prev) => {
        const cur = prev.trim();
        if (!cur) return env.suggestedPaymentNote!;
        if (cur.includes(env.suggestedPaymentNote!)) return cur;
        return `${cur} · ${env.suggestedPaymentNote}`;
      });
    }

    if (m.registerSalePaymentGuess !== null && m.registerSalePaymentGuess !== undefined) {
      setRegisterPayment(m.registerSalePaymentGuess);
    } else if (paymentGuess) {
      setRegisterPayment(true);
    }

    if (m.recordType === "catalog_service" && env.suggestedCatalog) {
      if (isFinanceMember) {
        toast.info("Item de catálogo identificado — peça a um administrador para cadastrá-lo.", {
          duration: 7000,
        });
        return;
      }
      const cat = env.suggestedCatalog;
      if (cat.name) setSvcName(cat.name);
      if (cat.description) setSvcDesc(cat.description);
      if (cat.defaultPriceCents != null && cat.defaultPriceCents > 0) {
        setSvcPriceRaw((cat.defaultPriceCents / 100).toFixed(2).replace(".", ","));
      }
      goToTab("catalogo");
      setCatalogEditorOpen(true);
      toast.success("Revise os dados no Catálogo e clique em Adicionar ao catálogo.");
      return;
    }

    if (m.recordType === "recurring_expense") {
      if (isFinanceMember) {
        toast.info("Gasto fixo identificado — peça a um administrador para registrá-lo.", {
          duration: 7000,
        });
        return;
      }
      goToTab("configurar");
      toast.info("Gasto fixo identificado — complete o formulário na aba Gastos Fixos.", {
        duration: 7000,
      });
      return;
    }

    goToTab("registrar");

    if (m.recordType === "patient_sale") {
      if (isFinanceMember) {
        toast.info("Venda identificada — peça a um administrador para registrá-la.", {
          duration: 7000,
        });
        return;
      }

      // Áudio só para baixar sessões de plano já existente — rascunho + confirmação (nunca grava na hora).
      const saleAction =
        env.suggestedSaleAction ??
        (m.saleActionGuess === "mark_sessions_done" ? "mark_sessions_done" : "new_sale");
      if (
        saleAction === "mark_sessions_done" &&
        env.suggestedPerformedSessionYyyyMmDd.length > 0
      ) {
        const pid = env.resolvedPatientId ?? patientIdFallback;
        if (!pid) {
          toast.error("Informe o paciente para marcar as sessões realizadas.");
          return;
        }
        setPurchasePatientId(pid);
        void (async () => {
          const list = await listPatientPurchases(pid);
          if (!list.success || !list.data?.length) {
            toast.error("Paciente sem planos com sessões pendentes para atualizar.");
            return;
          }
          const withPending = list.data.filter((row) => row.pendingCount > 0);
          if (withPending.length === 0) {
            toast.error("Não há sessões pendentes neste paciente.");
            return;
          }

          const sid = env.resolvedProfessionalServiceId;
          const serviceName =
            sid && activeServices.find((s) => s.id === sid)?.name?.toLowerCase();
          const nameMatches = serviceName
            ? withPending.filter(
                (row) =>
                  row.purchase.serviceName.toLowerCase().includes(serviceName) ||
                  serviceName.includes(row.purchase.serviceName.toLowerCase()),
              )
            : [];

          let purchaseId = "";
          let needsPurchasePick = false;
          if (nameMatches.length === 1) {
            purchaseId = nameMatches[0]!.purchase.id;
          } else if (withPending.length === 1) {
            purchaseId = withPending[0]!.purchase.id;
          } else {
            // Vários planos e sem match único — usuário escolhe; nunca default para o primeiro.
            needsPurchasePick = true;
            purchaseId = "";
          }

          const dates = env.suggestedPerformedSessionYyyyMmDd;
          const dateLabels = dates
            .map((ymd) => {
              const [y, m, d] = ymd.split("-");
              return y && m && d ? `${d}/${m}/${y}` : ymd;
            })
            .join(", ");
          const summary = needsPurchasePick
            ? `Há ${withPending.length} planos com pendência. Escolha o pacote e confirme as datas: ${dateLabels}.`
            : `Marcar ${dates.length} sessão(ões) em «${
                withPending.find((r) => r.purchase.id === purchaseId)?.purchase.serviceName ?? "plano"
              }»: ${dateLabels}.`;

          setSessionMarkDraft({
            patientId: pid,
            purchaseId,
            dates,
            summary,
            needsPurchasePick,
          });
          await loadPatientPurchasesPanel(pid);
          toast.info(
            needsPurchasePick
              ? "Selecione o plano e confirme as sessões — nada foi salvo ainda."
              : "Revise o plano e as datas e confirme — nada foi salvo ainda.",
            { duration: 7000 },
          );
        })().catch(() => toast.error("Falha ao preparar atualização de sessões."));
        return;
      }

      const pid = env.resolvedPatientId ?? patientIdFallback;
      if (pid) setPurchasePatientId(pid);
      const sid = env.resolvedProfessionalServiceId;
      if (sid && activeServices.some((s) => s.id === sid)) {
        setPurchaseServiceId(sid);
      }

      const cents = env.suggestedAgreedPriceCents ?? null;
      if (cents !== null && cents > 0) {
        setPurchasePriceRaw((cents / 100).toFixed(2).replace(".", ","));
      }

      const pt = m.purchaseTypeGuess;
      if (pt === "PACKAGE") {
        setPurchaseType("PACKAGE");
        const sess = m.packageSessionsGuess;
        if (sess && sess >= 2) {
          setPurchasePackageSessions(String(sess));
        }
      } else if (env.suggestedPerformedSessionYyyyMmDd.length > 0) {
        setPurchaseType("PACKAGE");
      } else {
        setPurchaseType("SINGLE");
      }

      if (env.suggestedPerformedSessionYyyyMmDd.length > 0) {
        setPurchasePerformedDates(env.suggestedPerformedSessionYyyyMmDd);
      }

      const noteParts = [
        m.narrativeSummaryPt?.trim(),
        env.suggestedPaymentNote,
      ].filter(Boolean) as string[];
      if (noteParts.length > 0) {
        setPurchaseNotes((prev) =>
          `${noteParts.join(" · ")}${prev.trim() ? `\n\n${prev}` : ""}`.slice(0, 4000),
        );
      }
      toast.success(
        env.suggestedPerformedSessionYyyyMmDd.length > 0
          ? `Venda atualizada com ${env.suggestedPerformedSessionYyyyMmDd.length} sessão(ões) já realizadas — confira antes de guardar.`
          : "Formulário de venda atualizado — confira o cliente, o trabalho e o valor.",
      );
    } else if (m.recordType === "standalone_transaction") {
      if (m.transactionKindGuess === "EXPENSE") {
        if (isFinanceMember) {
          toast.info("Despesa identificada — peça a um administrador para registrá-la.", {
            duration: 7000,
          });
          return;
        }
        toast.info(
          "Despesa pontual: use a aba Configurar → Gastos variáveis / imprevistos (ou o assistente).",
          { duration: 8000 },
        );
        goToTab("configurar");
        return;
      }

      // Receita: sempre exige paciente — preenche formulário de venda (ADMIN) ou entrada (MEMBER).
      const cents = env.suggestedStandaloneAmountCents ?? null;
      const px = env.resolvedPatientId;
      if (!px && !isFinanceMember) {
        toast.warning(
          "Informe o cliente (áudio ou menu) para registrar a receita. Entradas sem cliente não são permitidas.",
          { duration: 8000 },
        );
      }
      if (isFinanceMember) {
        setTxKind("INCOME");
        if (cents !== null && cents > 0) {
          setTxAmountRaw((cents / 100).toFixed(2).replace(".", ","));
        }
        setTxPatientId(px ?? "");
        if (m.narrativeSummaryPt) {
          setTxDescription((m.narrativeSummaryPt ?? "").slice(0, 2000));
        }
        toast.success("Entrada sugerida — confira o cliente e o valor antes de guardar.");
      } else {
        if (px) setPurchasePatientId(px);
        if (cents !== null && cents > 0) {
          setPurchasePriceRaw((cents / 100).toFixed(2).replace(".", ","));
        }
        if (m.narrativeSummaryPt) {
          setPurchaseNotes((m.narrativeSummaryPt ?? "").slice(0, 4000));
        }
        setRegisterPayment(true);
        toast.success(
          "Receita sugerida em «Venda do trabalho» — selecione o serviço e confirme o cliente.",
        );
      }
    } else if (m.recordType === "unclear") {
      toast.info(
        "A IA não teve informação suficiente. Grave com mais contexto ou anexe foto/PDF do comprovante.",
        { duration: 8000 },
      );
      if (m.narrativeSummaryPt) setPurchaseNotes(m.narrativeSummaryPt.slice(0, 4000));
    }

    void loadPatientPurchasesPanel(env.resolvedPatientId || patientIdFallback || purchasePatientId).catch(
      () => undefined,
    );
  }

  async function applyCatalogEnvelope(env: OfficeFinanceExtractionEnvelope) {
    env.warnings.forEach((msg) => toast.warning(msg, { duration: 7000 }));

    const items =
      env.suggestedCatalogItems.length > 0
        ? env.suggestedCatalogItems
        : env.suggestedCatalog
          ? [env.suggestedCatalog]
          : [];

    if (env.model.recordType === "catalog_service" && items.length > 0) {
      const savable = items.filter((item) => item.name?.trim());
      if (savable.length === 0) {
        applyFinanceExtractionEnvelope(env, purchasePatientId || (patients[0]?.id ?? ""));
        return;
      }

      setBusy(true);
      try {
        const res = await bulkImportProfessionalServices({
          items: savable.map((item) => ({
            name: item.name,
            description: item.description ?? undefined,
            defaultPriceCents: item.defaultPriceCents ?? 0,
            billingMode: item.billingMode ?? undefined,
          })),
        });

        if (!res.success) {
          toast.error(res.error);
          const first = savable[0]!;
          setSvcName(first.name);
          setSvcDesc(first.description ?? "");
          if (first.defaultPriceCents != null && first.defaultPriceCents > 0) {
            setSvcPriceRaw((first.defaultPriceCents / 100).toFixed(2).replace(".", ","));
          }
          goToTab("catalogo");
          setCatalogEditorOpen(true);
          return;
        }

        const count = res.data?.count ?? savable.length;
        await loadCatalog();
        // "catalogo" está em MEMBER_FINANCE_TABS — goToTab aplica a mesma regra RBAC.
        goToTab("catalogo");
        toast.success(
          count === 1
            ? "1 serviço importado para o catálogo."
            : `${count} serviços importados para o catálogo.`,
        );

        setSvcName("");
        setSvcDesc("");
        setSvcPriceRaw("");
        setEditingSvcId(null);
      } finally {
        setBusy(false);
      }
      return;
    }

    applyFinanceExtractionEnvelope(env, purchasePatientId || (patients[0]?.id ?? ""));
  }

  async function handleSaveService(e: React.FormEvent) {
    e.preventDefault();
    const cents = rawMoneyToCents(svcPriceRaw);
    if (cents === null) {
      toast.error("Preço inválido.");
      return;
    }
    setBusy(true);
    try {
      const res = await upsertProfessionalService({
        ...(editingSvcId ? { id: editingSvcId } : {}),
        name: svcName,
        description: svcDesc || undefined,
        defaultPriceCents: cents,
        billingMode: svcBillingMode,
        serviceSpaceId: svcSpaceId.trim() || null,
      });
      if (!res.success) toast.error(res.error);
      else {
        toast.success(editingSvcId ? "Serviço atualizado." : "Serviço criado.");
        setSvcName("");
        setSvcDesc("");
        setSvcPriceRaw("");
        setSvcSpaceId("");
        setSvcBillingMode("SESSION");
        setEditingSvcId(null);
        await loadCatalog();
        setCatalogEditorOpen(false);
        goToTab("catalogo");
      }
    } finally {
      setBusy(false);
    }
  }

  function startEditSvc(svc: (typeof services)[number]) {
    setEditingSvcId(svc.id);
    setSvcName(svc.name);
    setSvcDesc(svc.description ?? "");
    setSvcPriceRaw((svc.defaultPriceCents / 100).toFixed(2).replace(".", ","));
    setSvcSpaceId(svc.serviceSpaceId ?? "");
    setSvcBillingMode(svc.billingMode === "MONTHLY" ? "MONTHLY" : "SESSION");
  }

  async function toggleSvcActive(svc: (typeof services)[number]) {
    setBusy(true);
    try {
      const res = await upsertProfessionalService({
        id: svc.id,
        name: svc.name,
        description: svc.description ?? undefined,
        defaultPriceCents: svc.defaultPriceCents,
        billingMode: svc.billingMode === "MONTHLY" ? "MONTHLY" : "SESSION",
        active: !svc.active,
        // Não reenviar espaço: evita falhar se o espaço foi desactivado.
      });
      if (!res.success) toast.error(res.error);
      else {
        toast.success(!svc.active ? "Serviço reativado." : "Serviço desativado.");
        await loadCatalog();
      }
    } finally {
      setBusy(false);
    }
  }

  async function deleteSvc(svc: (typeof services)[number]) {
    const confirmed = window.confirm(
      `Excluir «${svc.name}» do catálogo?\n\nEsta ação não pode ser desfeita.`,
    );
    if (!confirmed) return;

    setBusy(true);
    try {
      const res = await deleteProfessionalService({ id: svc.id });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Serviço excluído.");
      if (editingSvcId === svc.id) {
        setEditingSvcId(null);
        setSvcName("");
        setSvcDesc("");
        setSvcPriceRaw("");
      }
      if (purchaseServiceId === svc.id) {
        setPurchaseServiceId("");
      }
      await loadCatalog();
    } finally {
      setBusy(false);
    }
  }

  async function handlePurchaseSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!purchasePatientId || !purchaseServiceId) {
      toast.error(
        !purchasePatientId
          ? "Selecione o cliente para vincular a venda."
          : "Selecione cliente e serviço.",
      );
      return;
    }
    const cents = rawMoneyToCents(purchasePriceRaw);
    if (cents === null || cents === 0) {
      toast.error("Valor da venda inválido.");
      return;
    }

    let chargeCents = cents;
    let paymentNote: string | undefined;
    if (registerPayment && paymentMethod === "CARD") {
      const resolved = resolveCardInstallmentFromForm({
        baseAmountCents: cents,
        installmentCountRaw: purchaseInstallmentCount,
        interestMode: purchaseInterestMode,
        interestPercentRaw: purchaseInterestPercentRaw,
      });
      if (!resolved.ok) {
        toast.error(resolved.error);
        return;
      }
      if (resolved.plan) {
        chargeCents = resolved.plan.totalCents;
        paymentNote = resolved.notes ?? undefined;
      } else {
        paymentNote =
          formatPaymentNotes({
            method: "CARD",
            cardKind: "CREDIT",
            installmentCount: null,
          }) ?? undefined;
      }
    }

    if (chargeCents !== cents) {
      const baseLabel = (cents / 100).toFixed(2).replace(".", ",");
      const chargeLabel = (chargeCents / 100).toFixed(2).replace(".", ",");
      const ok = window.confirm(
        `Total a registrar no caixa: R$ ${chargeLabel} (catálogo R$ ${baseLabel} + juros). Confirmar?`,
      );
      if (!ok) return;
    }

    const notesMerged = [purchaseNotes || undefined, paymentNote]
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(" · ");

    setBusy(true);
    try {
      const res = await createPatientPurchase({
        patientId: purchasePatientId,
        professionalServiceId: purchaseServiceId,
        type: purchaseType,
        agreedPriceCents: cents,
        ...(chargeCents !== cents ? { paymentAmountCents: chargeCents } : {}),
        sessionCountTotal: purchaseType === "PACKAGE" ? Number(purchasePackageSessions) || 0 : 1,
        notes: notesMerged || undefined,
        registerIncomePayment: registerPayment,
        paymentMethod: registerPayment ? paymentMethod : undefined,
        paymentOccurredAt: registerPayment
          ? yyyyMmDdToSaoPauloNoon(txDateStr) ?? new Date(`${txDateStr}T12:00:00-03:00`)
          : undefined,
        paymentDescription: paymentNote,
        idempotencyKey: purchaseCommandKey,
        ...(purchaseSpaceId.trim() ? { serviceSpaceId: purchaseSpaceId.trim() } : {}),
        ...(purchaseType === "PACKAGE" && purchasePerformedDates.length > 0
          ? {
              preConsumedSessions: purchasePerformedDates
                .map((ymd) => {
                  const at = yyyyMmDdToSaoPauloNoon(ymd);
                  return at ? { consumedAt: at } : null;
                })
                .filter((x): x is { consumedAt: Date } => Boolean(x)),
            }
          : {}),
      });
      if (!res.success) toast.error(res.error);
      else {
        toast.success("Registro criado.");
        setPurchaseCommandKey(newPurchaseCommandKey());
        setPurchasePerformedDates([]);
        setPurchaseInstallmentCount("");
        setPurchaseInterestMode("none");
        setPurchaseInterestPercentRaw("");
        await loadPatientPurchasesPanel(purchasePatientId);
        bumpReports();
        if (isFinanceAdmin) goToTab("analisar");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleTxSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!txPatientId.trim()) {
      toast.error("Selecione o cliente para registrar a entrada.");
      return;
    }
    const cents = rawMoneyToCents(txAmountRaw);
    if (cents === null || cents <= 0) {
      toast.error("Valor inválido.");
      return;
    }
    setBusy(true);
    try {
      const res = await createFinancialTransaction({
        kind: txKind,
        amountCents: cents,
        occurredAt:
          yyyyMmDdToSaoPauloNoon(txDateStr) ?? new Date(`${txDateStr}T12:00:00-03:00`),
        method: txMethod,
        description: txDescription || undefined,
        patientId: txPatientId,
        ...(txSpaceId.trim() ? { serviceSpaceId: txSpaceId.trim() } : {}),
      });
      if (!res.success) toast.error(res.error);
      else {
        toast.success(
          res.data?.linkedPurchaseId
            ? "Entrada criada e vinculada à venda pendente do cliente."
            : "Entrada criada e vinculada ao cliente.",
        );
        setTxAmountRaw("");
        setTxDescription("");
        await loadPatientPurchasesPanel(txPatientId);
        bumpReports();
        if (isFinanceAdmin) goToTab("analisar");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleConsumeSession(sessionId: string) {
    if (!canManagePatientServices) {
      toast.error("Sem permissão para baixar sessões. Peça ao administrador da clínica.");
      return;
    }
    setBusy(true);
    try {
      const res = await consumeServiceSessionManual({ sessionId });
      if (!res.success) toast.error(res.error);
      else {
        toast.success("Sessão marcada como realizada.");
        await loadPatientPurchasesPanel(purchasePatientId);
        bumpReports();
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmSessionMarkDraft() {
    if (!sessionMarkDraft) return;
    if (!sessionMarkDraft.purchaseId.trim()) {
      toast.error("Selecione o plano / pacote antes de confirmar.");
      return;
    }
    if (sessionMarkDraft.dates.length === 0) {
      toast.error("Informe ao menos uma data de sessão realizada.");
      return;
    }
    const { patientId, purchaseId, dates } = sessionMarkDraft;
    setBusy(true);
    try {
      const result = await consumePatientPurchaseSessionsByDates({
        purchaseId,
        dates,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      const { consumed, skipped } = result.data ?? { consumed: 0, skipped: 0 };
      const serviceName =
        purchaseHistory?.find((r) => r.purchase.id === purchaseId)?.purchase
          .serviceName ?? "plano";
      toast.success(
        skipped > 0
          ? `${consumed} sessão(ões) marcadas em «${serviceName}»; ${skipped} data(s) sem pendência.`
          : `${consumed} sessão(ões) marcadas em «${serviceName}».`,
      );
      setSessionMarkDraft(null);
      await loadPatientPurchasesPanel(patientId);
      bumpReports();
    } finally {
      setBusy(false);
    }
  }

  function handlePurchaseServiceChange(serviceId: string) {
    setPurchaseServiceId(serviceId);
    const s = activeServices.find((x) => x.id === serviceId);
    if (s) {
      setPurchasePriceRaw((s.defaultPriceCents / 100).toFixed(2).replace(".", ","));
      if (s.serviceSpaceId) setPurchaseSpaceId(s.serviceSpaceId);
    }
  }

  function handlePurchaseSpaceChange(spaceId: string) {
    setPurchaseSpaceId(spaceId);
    if (!purchaseServiceId) return;
    const s = activeServices.find((x) => x.id === purchaseServiceId);
    if (!s) return;
    const ok =
      !spaceId || s.serviceSpaceId == null || s.serviceSpaceId === spaceId;
    if (!ok) setPurchaseServiceId("");
  }

  if (planAllowed === null) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-success" aria-label="Carregando" />
      </div>
    );
  }

  if (!planAllowed) {
    return (
      <PremiumFeatureUpsellScreen
        feature={PREMIUM_FEATURES["office-finance"]}
        featureId="office-finance"
      />
    );
  }

  return (
    <div className="min-h-screen bg-background pb-14 text-foreground ">
      <div className="container mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
            <Wallet className="h-8 w-8 text-success dark:text-success" aria-hidden />
            Financeiro
          </h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Caixa das próteses: entradas, despesas e o catálogo de valores. Valor ou forma de
            pagamento citados no áudio entram aqui depois da confirmação. Quantas coletas e
            entregas foram feitas, e quando, fica na agenda.
          </p>
        </div>

        {(loadingPatients || busy) && (
          <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Atualizando…
          </div>
        )}

        {financeAccessError && (
          <div
            className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground"
            role="alert"
          >
            {financeAccessError}
          </div>
        )}

        {!financeRoleReady || !activeTab ? (
          financeAccessError ? (
            <p className="text-sm text-muted-foreground">
              Não foi possível carregar o painel financeiro. Verifique o perfil profissional e tente
              novamente.
            </p>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Carregando permissões…
            </div>
          )
        ) : (
          <>
        <FinanceTabNav
          active={activeTab}
          onChange={goToTab}
          allowed={isFinanceMember ? MEMBER_FINANCE_TABS : undefined}
        />

        {activeTab === "analisar" && isFinanceAdmin && (
          <FinanceAnalyzePanel
            reloadKey={reportReloadKey}
            onPeriodBoundsChange={(start, end) => setPeriodBounds({ start, end })}
            initialPreset={(deepLink.preset as FinancePeriodPreset | null) ?? null}
            initialAnchorIso={deepLink.anchorIso}
            initialFrom={deepLink.from}
            initialTo={deepLink.to}
            highlightPending={
              deepLink.action === "pending" || deepLink.action === "collect"
            }
            isTeamPlan={isTeamPlan}
            collectPurchaseId={
              deepLink.action === "collect" ? deepLink.purchaseId : null
            }
            collectPatientId={
              deepLink.action === "collect" ? deepLink.patientId : null
            }
            onCollectHandled={() =>
              setDeepLink((prev) =>
                prev.action === "collect" ? { ...prev, action: null, purchaseId: null } : prev,
              )
            }
          />
        )}

        {activeTab === "configurar" && isFinanceAdmin && (
          <FinanceConfigurePanel
            financePlan={financePlan}
            onRecurringChanged={bumpReports}
            canUseServiceSpaces={financePlan?.canUseServiceSpaces === true}
          />
        )}

        {activeTab === "catalogo" && (
          <FinanceCatalogPanel
            busy={busy}
            services={services}
            formatBrl={formatBrlFromCents}
            onStartEdit={(svc) => {
              if (isFinanceMember) return;
              startEditSvc(svc);
              setCatalogEditorOpen(true);
            }}
            onToggleActive={toggleSvcActive}
            onDelete={(svc) => void deleteSvc(svc)}
            editorOpen={catalogEditorOpen}
            onEditorOpenChange={setCatalogEditorOpen}
            financePlan={financePlan}
            svcName={svcName}
            svcDesc={svcDesc}
            svcPriceRaw={svcPriceRaw}
            svcSpaceId={svcSpaceId}
            svcBillingMode={svcBillingMode}
            editingSvcId={editingSvcId}
            onSvcName={setSvcName}
            onSvcDesc={setSvcDesc}
            onSvcPriceRaw={setSvcPriceRaw}
            onSvcSpaceId={setSvcSpaceId}
            onSvcBillingMode={setSvcBillingMode}
            onSaveService={handleSaveService}
            onCancelEditSvc={() => {
              setEditingSvcId(null);
              setSvcName("");
              setSvcDesc("");
              setSvcPriceRaw("");
              setSvcSpaceId("");
              setSvcBillingMode("SESSION");
            }}
            onCatalogEnvelope={applyCatalogEnvelope}
            readOnly={isFinanceMember}
          />
        )}

        {activeTab === "registrar" && (
          <FinanceRegisterPanel
            busy={busy}
            financePlan={financePlan}
            financeRole={financeRole ?? "ADMIN"}
            canManagePatientServices={canManagePatientServices}
            patients={patients}
            services={services}
            activeServices={registerActiveServices}
            onEnvelope={(env) =>
              applyFinanceExtractionEnvelope(env, purchasePatientId || (patients[0]?.id ?? ""))
            }
            onAgentChanged={() => {
              bumpReports();
              loadPatientPurchasesPanel(purchasePatientId).catch(() => undefined);
              if (isFinanceAdmin) goToTab("analisar");
            }}
            onPatientCreated={() => void loadPatients()}
            purchasePatientId={purchasePatientId}
            purchaseServiceId={purchaseServiceId}
            purchaseSpaceId={purchaseSpaceId}
            purchaseType={purchaseType}
            purchasePackageSessions={purchasePackageSessions}
            purchasePriceRaw={purchasePriceRaw}
            purchaseNotes={purchaseNotes}
            purchasePerformedDates={purchasePerformedDates}
            registerPayment={registerPayment}
            paymentMethod={paymentMethod}
            purchaseInstallmentCount={purchaseInstallmentCount}
            purchaseInterestMode={purchaseInterestMode}
            purchaseInterestPercentRaw={purchaseInterestPercentRaw}
            txDateStr={txDateStr}
            onPurchasePatientId={setPurchasePatientId}
            onPurchaseServiceId={handlePurchaseServiceChange}
            onPurchaseSpaceId={handlePurchaseSpaceChange}
            onPurchaseType={setPurchaseType}
            onPurchasePackageSessions={setPurchasePackageSessions}
            onPurchasePriceRaw={setPurchasePriceRaw}
            onPurchaseNotes={setPurchaseNotes}
            onPurchasePerformedDates={setPurchasePerformedDates}
            onRegisterPayment={setRegisterPayment}
            onPaymentMethod={setPaymentMethod}
            onPurchaseInstallmentCount={setPurchaseInstallmentCount}
            onPurchaseInterestMode={setPurchaseInterestMode}
            onPurchaseInterestPercentRaw={setPurchaseInterestPercentRaw}
            onTxDateStr={setTxDateStr}
            onPurchaseSubmit={handlePurchaseSubmit}
            txAmountRaw={txAmountRaw}
            txMethod={txMethod}
            txDescription={txDescription}
            txPatientId={txPatientId}
            txSpaceId={txSpaceId}
            onTxAmountRaw={setTxAmountRaw}
            onTxMethod={setTxMethod}
            onTxDescription={setTxDescription}
            onTxPatientId={setTxPatientId}
            onTxSpaceId={setTxSpaceId}
            onTxSubmit={handleTxSubmit}
            purchaseHistory={purchaseHistory}
            sessionMarkDraft={sessionMarkDraft}
            onSessionMarkDraftChange={setSessionMarkDraft}
            onConfirmSessionMarkDraft={() => void confirmSessionMarkDraft()}
            onConsumeSession={handleConsumeSession}
            formatBrl={formatBrlFromCents}
          />
        )}

        {activeTab === "fiscal" && isFinanceAdmin && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Período alinhado com a aba Analisar:{" "}
              <strong>
                {periodBounds.start.toLocaleDateString("pt-BR")} –{" "}
                {periodBounds.end.toLocaleDateString("pt-BR")}
              </strong>
            </p>
            <FiscalExportPanel
              periodStart={periodBounds.start}
              periodEnd={periodBounds.end}
              reloadKey={reportReloadKey}
            />
          </div>
        )}
          </>
        )}
      </div>
    </div>
  );
}
