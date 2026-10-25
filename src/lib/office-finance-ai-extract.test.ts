import test from "node:test";
import assert from "node:assert/strict";
import {
  envelopeFromModelOutput,
  extractCatalogItemsFromJson,
  normalizeOfficeFinanceModelJson,
  officeFinanceModelOutputSchema,
} from "./office-finance-ai-extract";

test("normalizeOfficeFinanceModelJson aceita valor pt-BR e recordType alias", () => {
  const normalized = normalizeOfficeFinanceModelJson(
    {
      recordType: "catalog",
      name: "Fisioterapia",
      valor: "R$ 180,00",
      serviceDescriptionGuess: "Sessão 50 min",
    },
    "catalog",
  );
  const parsed = officeFinanceModelOutputSchema.safeParse(normalized);
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.recordType, "catalog_service");
  assert.equal(parsed.data.professionalServiceGuess, "Fisioterapia");
  assert.equal(parsed.data.agreedAmountReais, 180);
  assert.equal(parsed.data.confidenceOverall, 0.55);
});

test("normalizeOfficeFinanceModelJson extrai primeiro item de array de serviços", () => {
  const normalized = normalizeOfficeFinanceModelJson(
    {
      services: [
        { nome: "Consulta", preco: 300 },
        { nome: "Retorno", preco: 150 },
      ],
      confidenceOverall: "0.9",
    },
    "catalog",
  );
  const parsed = officeFinanceModelOutputSchema.safeParse(normalized);
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.recordType, "catalog_service");
  assert.equal(parsed.data.professionalServiceGuess, "Consulta");
  assert.equal(parsed.data.agreedAmountReais, 300);
  assert.match(parsed.data.narrativeSummaryPt ?? "", /Retorno/);
});

test("extractCatalogItemsFromJson lê array de serviços do PDF", () => {
  const items = extractCatalogItemsFromJson({
    services: [
      { nome: "Consulta", preco: 300 },
      { nome: "Retorno", valor: "150,00" },
    ],
  });
  assert.equal(items.length, 2);
  assert.equal(items[0]?.name, "Consulta");
  assert.equal(items[0]?.defaultPriceCents, 30000);
  assert.equal(items[1]?.defaultPriceCents, 15000);
});

test("extractCatalogItemsFromJson extrai planos com valor à vista e crédito na descrição", () => {
  const items = extractCatalogItemsFromJson({
    services: [
      {
        name: "Plano de 12 Atendimentos",
        price: 1440,
        description: "R$ 120,00 por sessão. Crédito: até 3x de R$ 552,00.",
        packageSessionsGuess: 12,
      },
      {
        name: "Plano de 4 Atendimentos",
        agreedAmountReais: 600,
        serviceDescriptionGuess: "R$ 150,00 por sessão. Crédito: até 2x de R$ 345,00.",
        packageSessionsGuess: 4,
      },
      {
        name: "Plano Específico de Reabilitação de LCA",
        price: 600,
        description: "R$ 600,00 mensais.",
      },
    ],
  });
  assert.equal(items.length, 3);
  assert.equal(items[0]?.name, "Plano de 12 Atendimentos");
  assert.equal(items[0]?.defaultPriceCents, 144000);
  assert.match(items[0]?.description ?? "", /Crédito/);
  assert.equal(items[1]?.defaultPriceCents, 60000);
  assert.equal(items[2]?.name, "Plano Específico de Reabilitação de LCA");
  assert.equal(items[2]?.defaultPriceCents, 60000);
});

test("envelopeFromModelOutput inclui suggestedCatalogItems", () => {
  const env = envelopeFromModelOutput(
    {
      recordType: "catalog_service",
      professionalServiceGuess: "Fisioterapia",
      agreedAmountReais: 180,
      confidenceOverall: 0.9,
    },
    [],
    [],
    [{ name: "Pilates", description: null, defaultPriceCents: 20000, billingMode: "MONTHLY" }],
  );
  assert.equal(env.suggestedCatalogItems.length, 2);
  assert.equal(env.suggestedCatalogItems[0]?.name, "Fisioterapia");
});

test("envelopeFromModelOutput extrai catálogo de PDF/serviço", () => {
  const env = envelopeFromModelOutput(
    {
      recordType: "catalog_service",
      professionalServiceGuess: "Fisioterapia",
      serviceDescriptionGuess: "Sessão 50 min",
      agreedAmountReais: 180,
      confidenceOverall: 0.9,
    },
    [],
    [],
  );
  assert.equal(env.suggestedCatalog?.name, "Fisioterapia");
  assert.equal(env.suggestedCatalog?.defaultPriceCents, 18000);
  assert.equal(env.suggestedCatalog?.description, "Sessão 50 min");
});

test("envelopeFromModelOutput extrai gasto fixo recorrente", () => {
  const env = envelopeFromModelOutput(
    {
      recordType: "recurring_expense",
      recurringNameGuess: "Aluguel da sala",
      categoryGuess: "aluguel",
      agreedAmountReais: 1200,
      frequencyGuess: "MONTHLY",
      anchorDayGuess: 5,
      paymentMethodGuess: "PIX",
      confidenceOverall: 0.85,
    },
    [],
    [],
  );
  assert.equal(env.suggestedRecurring?.name, "Aluguel da sala");
  assert.equal(env.suggestedRecurring?.amountCents, 120000);
  assert.equal(env.suggestedRecurring?.frequency, "MONTHLY");
});

test("coerceDateGuessToYyyyMmDd aceita dd/mm sem ano", async () => {
  const { coerceDateGuessToYyyyMmDd, coercePerformedSessionDates } = await import(
    "./office-finance-ai-extract"
  );
  const short = coerceDateGuessToYyyyMmDd("21/07");
  assert.ok(short);
  assert.match(short!, /^\d{4}-07-21$/);

  const dates = coercePerformedSessionDates(["21/07", "08/08", "16/08", "21/07"]);
  assert.equal(dates.length, 3);
  assert.equal(dates[0]!.slice(5), "07-21");
  assert.equal(dates[1]!.slice(5), "08-08");
  assert.equal(dates[2]!.slice(5), "08-16");
});

test("envelopeFromModelOutput propaga sessões já realizadas do pacote", () => {
  const env = envelopeFromModelOutput(
    {
      recordType: "patient_sale",
      patientNameGuess: "Pâmela",
      professionalServiceGuess: "Plano de 4 Atendimentos",
      purchaseTypeGuess: "PACKAGE",
      packageSessionsGuess: 4,
      performedSessionDatesGuess: ["21/07", "08/08", "16/08"],
      performedSessionsCountGuess: 3,
      agreedAmountReais: 640,
      occurredDateGuess: "21/07/2026",
      registerSalePaymentGuess: true,
      paymentMethodGuess: "PIX",
      narrativeSummaryPt: "Plano de 4; 3 sessões já feitas.",
      confidenceOverall: 0.9,
    },
    [{ id: "p1", name: "Pâmela" }],
    [{ id: "s1", name: "Plano de 4 Atendimentos", defaultPriceCents: 64000 }],
  );
  assert.equal(env.suggestedPerformedSessionYyyyMmDd.length, 0);
  assert.equal(env.suggestedSaleAction, "new_sale");
  assert.equal(env.resolvedPatientId, "p1");
  assert.equal(env.resolvedProfessionalServiceId, "s1");
  assert.equal(env.model.purchaseTypeGuess, "SINGLE");
  assert.equal(env.model.packageSessionsGuess, null);
});


test("envelopeFromModelOutput marca mark_sessions_done sem criar pacote", () => {
  const env = envelopeFromModelOutput(
    {
      recordType: "patient_sale",
      patientNameGuess: "Ana",
      professionalServiceGuess: null,
      purchaseTypeGuess: null,
      packageSessionsGuess: null,
      performedSessionDatesGuess: ["08 de julho", "16 de julho"],
      performedSessionsCountGuess: 2,
      saleActionGuess: "mark_sessions_done",
      agreedAmountReais: null,
      occurredDateGuess: null,
      registerSalePaymentGuess: null,
      paymentMethodGuess: null,
      narrativeSummaryPt: "Marcar como realizadas 08 e 16 de julho.",
      confidenceOverall: 0.9,
    },
    [{ id: "p1", name: "Ana" }],
    [{ id: "s1", name: "Plano 8 sessões", defaultPriceCents: 80000 }],
  );
  assert.equal(env.suggestedSaleAction, "new_sale");
  assert.equal(env.suggestedPerformedSessionYyyyMmDd.length, 0);
});

test("envelopeFromModelOutput expande lista de dias + mês na narrativa", () => {
  const env = envelopeFromModelOutput(
    {
      recordType: "patient_sale",
      patientNameGuess: "Ana",
      professionalServiceGuess: null,
      purchaseTypeGuess: null,
      packageSessionsGuess: null,
      performedSessionDatesGuess: null,
      performedSessionsCountGuess: 8,
      saleActionGuess: "mark_sessions_done",
      agreedAmountReais: null,
      occurredDateGuess: null,
      registerSalePaymentGuess: null,
      paymentMethodGuess: null,
      narrativeSummaryPt:
        "Paciente realizou as sessões do plano nos dias 07, 09, 14, 16, 21, 23, 28 e 30 de julho.",
      confidenceOverall: 0.88,
    },
    [{ id: "p1", name: "Ana" }],
    [],
  );
  assert.equal(env.suggestedSaleAction, "new_sale");
  assert.equal(env.suggestedPerformedSessionYyyyMmDd.length, 0);
});

test("envelopeFromModelOutput reconhece crédito parcelado em Nx", () => {
  const env = envelopeFromModelOutput(
    {
      recordType: "patient_sale",
      patientNameGuess: "Ana",
      professionalServiceGuess: "Fisioterapia",
      purchaseTypeGuess: "SINGLE",
      packageSessionsGuess: null,
      performedSessionDatesGuess: null,
      agreedAmountReais: 800,
      paymentMethodGuess: "crédito",
      installmentCountGuess: null,
      registerSalePaymentGuess: null,
      narrativeSummaryPt: "Pagou no crédito parcelado em cinco vezes",
      confidenceOverall: 0.9,
    },
    [{ id: "p1", name: "Ana" }],
    [{ id: "s1", name: "Fisioterapia", defaultPriceCents: 80000 }],
  );
  assert.equal(env.model.paymentMethodGuess, "CARD");
  assert.equal(env.suggestedInstallmentCount, 5);
  assert.equal(env.model.registerSalePaymentGuess, true);
  assert.match(env.suggestedPaymentNote ?? "", /5x/);
});

test("normalizeOfficeFinanceModelJson aceita aliases de pagamento pt-BR", () => {
  const normalized = normalizeOfficeFinanceModelJson(
    {
      recordType: "standalone_transaction",
      agreedAmountReais: "150,00",
      paymentMethodGuess: "cartão de crédito",
      parcelas: "3x",
      narrativeSummaryPt: "recebido no cartão",
      confidenceOverall: 0.8,
    },
    "standalone",
  );
  assert.equal(normalized.paymentMethodGuess, "CARD");
  assert.equal(normalized.installmentCountGuess, 3);
});
