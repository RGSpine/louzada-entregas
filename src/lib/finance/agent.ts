/**
 * Núcleo de raciocínio do Agente Financeiro (DeepSeek-v4-flash, texto puro).
 *
 * Recebe texto (digitado pelo profissional e/ou transcrição/OCR vinda do
 * Gemini Flash) + contexto do consultório e devolve uma PROPOSTA estruturada
 * de ação. NÃO persiste nada e NÃO faz aritmética de dinheiro — apenas
 * interpreta intenção e extrai campos. A gravação acontece via server actions
 * após confirmação do usuário; os cálculos vivem em código determinístico.
 */
import { z } from "zod";
import { DateTime } from "luxon";
import { generateTextWithDeepSeek, isDeepSeekConfigured } from "@/lib/deepseek";
import { sanitizeText } from "@/lib/sanitize";
import { DEFAULT_SCHEDULE_TIMEZONE } from "@/lib/schedule-temporal-parse";
import {
  resolvePatientIdFromGuess,
  resolveServiceIdFromGuess,
  coerceDateGuessToYyyyMmDd,
  type OfficeFinanceContextPatient,
  type OfficeFinanceContextService,
} from "@/lib/office-finance-ai-extract";
import { FINANCE_PERIOD_PRESETS } from "@/lib/finance/period";
import {
  formatPaymentNotes,
  inferPortuguesePayment,
  normalizePaymentMethodToken,
} from "@/lib/finance/portuguese-payment";
import { mergePerformedSessionDateGuesses } from "@/lib/finance/portuguese-session-dates";
import type { FinancialTransactionMethod } from "@prisma/client";

export const financeAgentOutputSchema = z.object({
  intent: z.enum([
    "register_income",
    "register_patient_sale",
    "register_expense",
    "define_fixed_expense",
    "report",
    "unclear",
  ]),
  assistantMessage: z.string().max(800),
  confidence: z.number().min(0).max(1),
  amountReais: z.number().nonnegative().nullable().optional(),
  method: z.enum(["CASH", "PIX", "CARD", "TRANSFER", "OTHER"]).nullable().optional(),
  /** Parcelas no crédito (2–48). */
  installmentCount: z.number().int().min(2).max(48).nullable().optional(),
  cardKind: z.enum(["CREDIT", "DEBIT"]).nullable().optional(),
  occurredDate: z.string().max(64).nullable().optional(),
  patientNameGuess: z.string().max(200).nullable().optional(),
  isNewPatient: z.boolean().nullable().optional(),
  serviceGuess: z.string().max(200).nullable().optional(),
  purchaseType: z.enum(["SINGLE", "PACKAGE"]).nullable().optional(),
  packageSessions: z.number().int().min(2).max(200).nullable().optional(),
  /** true se o pagamento já foi recebido e deve lançar receita no caixa junto com a venda. */
  registerIncomePaymentGuess: z.boolean().nullable().optional(),
  /**
   * Datas de sessões já realizadas (dd/mm, yyyy-mm-dd, "08 de julho"…).
   * Usado em register_patient_sale para pré-consumir sessões do pacote.
   */
  performedSessionDates: z.array(z.string().max(64)).max(200).nullable().optional(),
  category: z.string().max(120).nullable().optional(),
  expenseNature: z.enum(["FIXED", "VARIABLE"]).nullable().optional(),
  description: z.string().max(800).nullable().optional(),
  recurringFrequency: z.enum(["WEEKLY", "MONTHLY", "YEARLY"]).nullable().optional(),
  recurringAnchorDay: z.number().int().min(1).max(31).nullable().optional(),
  reportPreset: z.enum(FINANCE_PERIOD_PRESETS).nullable().optional(),
  reportOffset: z.number().int().min(-1200).max(1200).nullable().optional(),
});

export type FinanceAgentOutput = z.infer<typeof financeAgentOutputSchema>;

export type FinanceAgentProposal = {
  model: FinanceAgentOutput;
  resolvedPatientId: string | null;
  resolvedServiceId: string | null;
  suggestedAmountCents: number | null;
  suggestedOccurredYyyyMmDd: string | null;
  suggestedInstallmentCount: number | null;
  suggestedPaymentNote: string | null;
  suggestedPerformedSessionYyyyMmDd: string[];
  warnings: string[];
};

export type FinanceAgentContext = {
  patients: OfficeFinanceContextPatient[];
  services: OfficeFinanceContextService[];
  recurringExpenses: Array<{ name: string; amountCents: number; category: string | null }>;
  timezone?: string;
};

function reaisToCents(amount: number | null | undefined): number | null {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

function stripJsonFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function buildPrompt(userText: string, ctx: FinanceAgentContext): { system: string; user: string } {
  const tz = ctx.timezone || DEFAULT_SCHEDULE_TIMEZONE;
  const now = DateTime.now().setZone(tz);
  const todayIso = now.toFormat("yyyy-LL-dd");
  const weekdayPt = now.setLocale("pt-BR").toFormat("cccc");

  const patientLines = ctx.patients.length
    ? ctx.patients.map((p) => `- ${p.name}`).join("\n")
    : "(nenhum paciente cadastrado)";
  const serviceLines = ctx.services.length
    ? ctx.services
        .map((s) => `- ${s.name} (~ R$ ${(s.defaultPriceCents / 100).toFixed(2)})`)
        .join("\n")
    : "(catálogo vazio)";
  const recurringLines = ctx.recurringExpenses.length
    ? ctx.recurringExpenses
        .map((r) => `- ${r.name} (R$ ${(r.amountCents / 100).toFixed(2)})`)
        .join("\n")
    : "(nenhuma despesa fixa salva)";

  const system = `
És o Agente Financeiro de um consultório de saúde no Brasil. Interpretas pedidos do profissional
sobre o caixa do consultório e devolves SEMPRE um único objeto JSON válido (sem texto fora do JSON).
Nunca inventas valores nem pacientes. Quando não houver certeza, usa null e confidence baixo.
Não fazes contas: apenas extrais o que foi dito. Respondes em português do Brasil em assistantMessage.

Data de hoje: ${todayIso} (${weekdayPt}), fuso ${tz}.

Decide a intenção (intent):
- "register_patient_sale": venda de serviço DO CATÁLOGO a um paciente — consulta única (SINGLE) ou pacote de N sessões (PACKAGE). Exige patientNameGuess e serviceGuess. Preenche purchaseType (SINGLE ou PACKAGE), packageSessions (≥2 se pacote), registerIncomePaymentGuess (true se pagamento já recebido).
- "register_income": entrada no caixa vinculada a um paciente (sem criar venda/pacote de sessões).
  Exige patientNameGuess (paciente existente ou novo). NÃO uses serviceGuess aqui.
  Nunca registre receita sem paciente.
- "register_expense": registrar uma SAÍDA pontual (despesa flutuante / imprevisto) — usa expenseNature="VARIABLE". Vale só o mês civil da data; no mês seguinte some da análise mensal. Nunca trate como gasto fixo recorrente.
- "define_fixed_expense": salvar um GASTO FIXO recorrente (ex.: aluguel mensal) — preenche recurringFrequency e recurringAnchorDay; expenseNature="FIXED".
- "report": o profissional pergunta sobre o CAIXA / saúde financeira OU pede números de um período.
  Exemplos: "como está meu líquido?", "quanto entrou este mês?", "saúde financeira", "mês passado", "este trimestre".
  Preenche reportPreset (DAY, WEEK, MONTH, QUARTER, SEMESTER, YEAR) e reportOffset (0=atual, -1=anterior…).
  Em assistantMessage: explique em 2–4 frases o que os números significam para o consultório (sem inventar valores — os totais reais serão anexados pelo sistema).
- "unclear": faltou informação essencial; em assistantMessage faz UMA pergunta objetiva.

Regras de campos:
- amountReais: número decimal em reais (ex.: 150 para R$150) ou null.
- occurredDate: dd/mm/aaaa ou aaaa-mm-dd se mencionada; senão null (assume hoje no registo).
- patientNameGuess: nome do paciente citado (se houver). isNewPatient=true se parecer um paciente NÃO presente na lista abaixo.
- serviceGuess: nome do serviço do catálogo — só para register_patient_sale.
- purchaseType: SINGLE (1 sessão) ou PACKAGE (≥2). packageSessions: número de sessões se pacote.
- registerIncomePaymentGuess: true se ficou implícito que o pagamento JÁ foi recebido; false se só registrou a venda; null se incerto (assumir true na venda).
- performedSessionDates: se o profissional disser que o paciente JÁ FEZ sessões em datas concretas
  ("já realizou em 08 e 16 de julho", "nos dias 07, 09, 14 de julho"), liste cada data (dd/mm, "08 de julho"…).
  null se nenhuma sessão já feita.
- method: forma de pagamento — CASH | PIX | CARD | TRANSFER | OTHER (nunca escrevas "crédito"/"débito"/"dinheiro":
  mapeia dinheiro→CASH, pix→PIX, crédito/débito/cartão→CARD, TED/DOC/transferência→TRANSFER).
- installmentCount: se disser "em 5x", "parcelado em oito vezes", "3 parcelas" no crédito, devolve o número (2–48); senão null.
- cardKind: "CREDIT" se crédito/parcelado; "DEBIT" se débito; null se só cartão genérico.
- category: categoria curta da despesa (ex.: aluguel, materiais, impostos, marketing) ou null.
`.trim();

  const user = `
CONTEXTO DO PROFISSIONAL (use só para desambiguar; NÃO invente):
Pacientes cadastrados:
${patientLines}

Serviços no catálogo:
${serviceLines}

Despesas fixas já salvas:
${recurringLines}

PEDIDO DO PROFISSIONAL (texto digitado e/ou transcrição de áudio/OCR de comprovante):
"""
${userText}
"""

Devolve SOMENTE o objeto JSON com as chaves:
intent, assistantMessage, confidence, amountReais, method, installmentCount, cardKind, occurredDate, patientNameGuess,
isNewPatient, serviceGuess, purchaseType, packageSessions, registerIncomePaymentGuess, performedSessionDates, category,
expenseNature, description, recurringFrequency, recurringAnchorDay, reportPreset, reportOffset.
Use null onde não houver informação.
`.trim();

  return { system, user };
}

function coerceAgentJson(raw: unknown, userText: string): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const obj = { ...(raw as Record<string, unknown>) };
  const payment = inferPortuguesePayment({
    text: [userText, typeof obj.description === "string" ? obj.description : "", typeof obj.assistantMessage === "string" ? obj.assistantMessage : ""].join("\n"),
    methodToken: obj.method,
    installmentToken: obj.installmentCount ?? obj.parcelas ?? obj.installments,
  });
  if (payment.method) {
    obj.method = payment.method;
  } else if (obj.method != null) {
    obj.method = normalizePaymentMethodToken(obj.method);
  }
  if (payment.installmentCount != null) {
    obj.installmentCount = payment.installmentCount;
  } else if (obj.installmentCount != null) {
    const n =
      typeof obj.installmentCount === "number"
        ? Math.round(obj.installmentCount)
        : Number(obj.installmentCount);
    obj.installmentCount = Number.isFinite(n) && n >= 2 && n <= 48 ? n : null;
  }
  if (payment.cardKind) {
    obj.cardKind = payment.cardKind;
  }
  if (
    payment.method &&
    obj.registerIncomePaymentGuess == null &&
    (obj.intent === "register_income" || obj.intent === "register_patient_sale")
  ) {
    obj.registerIncomePaymentGuess = true;
  }
  if (typeof obj.performedSessionDates === "string" && obj.performedSessionDates.trim()) {
    obj.performedSessionDates = obj.performedSessionDates
      .split(/[,;]| e /i)
      .map((s: string) => s.trim())
      .filter(Boolean)
      .slice(0, 200);
  }
  return obj;
}

function buildProposal(
  model: FinanceAgentOutput,
  ctx: FinanceAgentContext,
  userText?: string,
): FinanceAgentProposal {
  const warnings: string[] = [];

  const patientMatch = resolvePatientIdFromGuess(model.patientNameGuess ?? null, ctx.patients);
  const needsPatient =
    model.intent === "register_income" || model.intent === "register_patient_sale";

  if (
    needsPatient &&
    (model.patientNameGuess?.trim()?.length ?? 0) > 0 &&
    !patientMatch &&
    !model.isNewPatient
  ) {
    warnings.push("Paciente não foi encontrado na sua lista; confirme ou cadastre um novo.");
  }

  if (model.intent === "register_patient_sale" && !(model.patientNameGuess?.trim()?.length ?? 0)) {
    warnings.push("Informe qual paciente comprou o serviço.");
  }

  const serviceMatch =
    model.intent === "register_patient_sale"
      ? resolveServiceIdFromGuess(model.serviceGuess ?? null, ctx.services)
      : null;

  if (
    model.intent === "register_patient_sale" &&
    (model.serviceGuess?.trim()?.length ?? 0) > 0 &&
    !serviceMatch
  ) {
    warnings.push("Serviço não casou com o catálogo; escolha manualmente ou cadastre o serviço.");
  }

  if (model.intent === "register_patient_sale" && !model.serviceGuess?.trim()) {
    warnings.push("Informe qual serviço foi vendido (nome do catálogo).");
  }

  if (
    model.intent === "register_patient_sale" &&
    model.purchaseType === "PACKAGE" &&
    (!model.packageSessions || model.packageSessions < 2)
  ) {
    warnings.push("Pacote precisa de ao menos 2 sessões; confirme o número.");
  }

  const cents = reaisToCents(model.amountReais ?? null);
  if (
    (model.intent === "register_income" ||
      model.intent === "register_patient_sale" ||
      model.intent === "register_expense" ||
      model.intent === "define_fixed_expense") &&
    cents == null
  ) {
    warnings.push("Valor não identificado com segurança; informe o montante.");
  }

  let suggestedOccurred = coerceDateGuessToYyyyMmDd(model.occurredDate ?? null);
  if (
    !suggestedOccurred &&
    (model.intent === "register_income" ||
      model.intent === "register_patient_sale" ||
      model.intent === "register_expense")
  ) {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    suggestedOccurred = `${y}-${m}-${da}`;
  }

  if (model.confidence < 0.45) {
    warnings.push("Confiança baixa na interpretação; revise antes de confirmar.");
  }

  const safeMessage = model.assistantMessage?.trim()
    ? sanitizeText(model.assistantMessage)
    : "";

  const paymentNote = formatPaymentNotes({
    method: (model.method ?? null) as FinancialTransactionMethod | null,
    cardKind: model.cardKind ?? null,
    installmentCount: model.installmentCount ?? null,
  });

  const suggestedPerformedSessionYyyyMmDd =
    model.intent === "register_patient_sale"
      ? mergePerformedSessionDateGuesses({
          modelDates: model.performedSessionDates ?? null,
          narrativeText: [userText, model.description, model.assistantMessage]
            .filter(Boolean)
            .join("\n"),
          coerceDate: coerceDateGuessToYyyyMmDd,
        })
      : [];

  if (
    model.intent === "register_patient_sale" &&
    suggestedPerformedSessionYyyyMmDd.length > 0 &&
    model.purchaseType !== "PACKAGE" &&
    (!model.packageSessions || model.packageSessions < 2)
  ) {
    warnings.push(
      "Há sessões já realizadas no áudio — confirme se o plano/pacote e o total de sessões estão corretos.",
    );
  }

  return {
    model: { ...model, assistantMessage: safeMessage },
    resolvedPatientId: patientMatch?.id ?? null,
    resolvedServiceId: serviceMatch?.id ?? null,
    suggestedAmountCents: cents,
    suggestedOccurredYyyyMmDd: suggestedOccurred,
    suggestedInstallmentCount: model.installmentCount ?? null,
    suggestedPaymentNote: paymentNote,
    suggestedPerformedSessionYyyyMmDd,
    warnings,
  };
}

/**
 * Executa o raciocínio do agente sobre `userText` (já inclui transcrição/OCR, se houve mídia).
 */
export async function runFinanceAgent(
  userText: string,
  ctx: FinanceAgentContext,
): Promise<{ ok: true; proposal: FinanceAgentProposal } | { ok: false; error: string }> {
  if (!isDeepSeekConfigured()) {
    return { ok: false, error: "Agente financeiro indisponível: DEEPSEEK_API_KEY não configurada." };
  }
  const text = userText?.trim();
  if (!text) {
    return { ok: false, error: "Nada para interpretar: envie texto, áudio ou comprovante." };
  }

  const { system, user } = buildPrompt(text, ctx);

  let raw: string;
  try {
    raw = await generateTextWithDeepSeek({
      systemInstruction: system,
      userPrompt: user,
      jsonMode: true,
      temperature: 0.1,
      maxTokens: 1200,
      timeoutMs: 60_000,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao consultar o agente." };
  }

  let json: unknown;
  try {
    json = JSON.parse(stripJsonFences(raw));
  } catch {
    return { ok: false, error: "O agente não devolveu JSON válido." };
  }

  const parsed = financeAgentOutputSchema.safeParse(coerceAgentJson(json, text));
  if (!parsed.success) {
    return { ok: false, error: "Resposta do agente não pôde ser validada." };
  }

  return { ok: true, proposal: buildProposal(parsed.data, ctx, text) };
}
