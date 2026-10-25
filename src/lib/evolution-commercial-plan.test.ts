import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEnrichedFinancialServiceSuggestion,
  detectCommercialCarePlanFromText,
  detectPaymentReceivedFromText,
  extractAmountReaisFromText,
  extractSessionCountFromServiceName,
  normalizeCatalogSynonyms,
  stripCommercialRegistrationActions,
} from "./evolution-commercial-plan";

test("detecta plano de N sessões no texto da evolução", () => {
  const plan = detectCommercialCarePlanFromText(
    "Paciente contratou um plano de 8 sessões de atendimento hoje.",
  );
  assert.equal(plan?.contracted, true);
  assert.equal(plan?.purchaseType, "PACKAGE");
  assert.equal(plan?.sessionCount, 8);
});

test("detecta plano de N atendimentos (sinónimo de sessões)", () => {
  const plan = detectCommercialCarePlanFromText(
    "Paciente contratou um plano de 4 atendimentos de fisioterapia.",
  );
  assert.equal(plan?.contracted, true);
  assert.equal(plan?.sessionCount, 4);
});

test("normaliza sinónimos sessões ↔ atendimentos ↔ consultas", () => {
  assert.equal(normalizeCatalogSynonyms("plano de 4 sessões"), "plano de 4 atendimentos");
  assert.equal(normalizeCatalogSynonyms("8 consultas"), "8 atendimentos");
});

test("extrai N do nome do serviço no catálogo", () => {
  assert.equal(extractSessionCountFromServiceName("Plano de 4 Atendimentos"), 4);
  assert.equal(extractSessionCountFromServiceName("Plano de 8 sessões"), 8);
  assert.equal(extractSessionCountFromServiceName("Consulta Avulsa"), null);
});

test("casa plano de 4 sessões com «Plano de 4 Atendimentos» no catálogo", () => {
  const suggestion = buildEnrichedFinancialServiceSuggestion(
    "A paciente iniciou um plano de tratamento de quatro sessões de fisioterapia, com a primeira sessão já realizada e o valor pago.",
    [
      { id: "svc-avulsa", name: "Consulta e Avaliação Avulsa", defaultPriceCents: 22000 },
      { id: "svc-4", name: "Plano de 4 Atendimentos", defaultPriceCents: 60000 },
      { id: "svc-8", name: "Plano de 8 Atendimentos", defaultPriceCents: 108000 },
      {
        id: "svc-lca",
        name: "Plano Específico de Reabilitação de LCA",
        defaultPriceCents: 60000,
      },
    ],
    {
      contracted: true,
      purchaseType: "PACKAGE",
      sessionCount: 4,
      serviceNameHint: "fisioterapia",
    },
  );
  assert.ok(suggestion);
  assert.equal(suggestion?.serviceId, "svc-4");
  assert.equal(suggestion?.catalogMissing, false);
  assert.equal(suggestion?.autoAcceptRecommended, true);
  assert.equal(suggestion?.sessionCount, 4);
});

test("enriquece sugestão com PACKAGE e autoAccept quando há catálogo", () => {
  const suggestion = buildEnrichedFinancialServiceSuggestion(
    "Realizou Pilates clínico e contratou plano de 8 sessoes.",
    [{ id: "svc-2", name: "Pilates clínico", defaultPriceCents: 18000 }],
    { contracted: true, purchaseType: "PACKAGE", sessionCount: 8 },
  );
  assert.ok(suggestion);
  assert.equal(suggestion?.serviceId, "svc-2");
  assert.equal(suggestion?.purchaseType, "PACKAGE");
  assert.equal(suggestion?.sessionCount, 8);
  assert.equal(suggestion?.autoAcceptRecommended, true);
  assert.equal(suggestion?.catalogMissing, false);
});

test("marca catalogMissing quando há plano mas sem serviço no catálogo", () => {
  const suggestion = buildEnrichedFinancialServiceSuggestion(
    "Contratou plano de 10 sessoes de fisioterapia.",
    [],
    { contracted: true, purchaseType: "PACKAGE", sessionCount: 10 },
  );
  assert.ok(suggestion);
  assert.equal(suggestion?.catalogMissing, true);
  assert.equal(suggestion?.sessionCount, 10);
});

test("marca catalogMissing quando há ambiguidade de N sessões", () => {
  const suggestion = buildEnrichedFinancialServiceSuggestion(
    "Contratou plano de 4 sessões.",
    [
      { id: "a", name: "Plano de 4 Atendimentos", defaultPriceCents: 60000 },
      { id: "b", name: "Pacote 4 Atendimentos Premium", defaultPriceCents: 70000 },
    ],
    { contracted: true, purchaseType: "PACKAGE", sessionCount: 4 },
  );
  assert.ok(suggestion);
  assert.equal(suggestion?.catalogMissing, true);
});

test("remove action items só de cadastro comercial", () => {
  const filtered = stripCommercialRegistrationActions(
    {
      v: 1,
      items: [
        { label: "Cadastrar plano de 8 sessões no financeiro" },
        { label: "Solicitar exame de imagem" },
      ],
    },
    { contracted: true, purchaseType: "PACKAGE", sessionCount: 8 },
  );
  assert.equal(filtered?.items.length, 1);
  assert.equal(filtered?.items[0]?.label, "Solicitar exame de imagem");
});

test("extrai valor em reais e pagamento Pix do texto", () => {
  assert.equal(extractAmountReaisFromText("pagou R$ 600 no Pix"), 600);
  assert.equal(extractAmountReaisFromText("valor de 1.200,50 reais"), 1200.5);
  assert.equal(detectPaymentReceivedFromText("valor pago no Pix"), true);
  assert.equal(detectPaymentReceivedFromText("ainda nao pagou"), false);
});

test("enriquece sugestão com Pix, valor pago e amountCents", () => {
  const suggestion = buildEnrichedFinancialServiceSuggestion(
    "Contratou plano de 4 atendimentos, pagou R$ 600 no Pix, primeira sessao hoje.",
    [{ id: "svc-4", name: "Plano de 4 Atendimentos", defaultPriceCents: 60000 }],
    {
      contracted: true,
      purchaseType: "PACKAGE",
      sessionCount: 4,
      thisVisitIsPlanSession: true,
      paymentReceived: true,
      paymentMethod: "PIX",
      amountReais: 600,
      sessionsAlreadyDone: 1,
    },
  );
  assert.ok(suggestion);
  assert.equal(suggestion?.catalogMissing, false);
  assert.equal(suggestion?.paymentReceived, true);
  assert.equal(suggestion?.paymentMethod, "PIX");
  assert.equal(suggestion?.amountCents, 60000);
  assert.equal(suggestion?.sessionsAlreadyDone, 1);
});

test("não recomenda registrar entrada quando áudio diz não pago", () => {
  const suggestion = buildEnrichedFinancialServiceSuggestion(
    "Contratou plano de 8 sessoes de Pilates clinico; ainda nao pagou.",
    [{ id: "svc-2", name: "Pilates clínico", defaultPriceCents: 18000 }],
    { contracted: true, purchaseType: "PACKAGE", sessionCount: 8, paymentReceived: false },
  );
  assert.ok(suggestion);
  assert.equal(suggestion?.paymentReceived, false);
  assert.equal(suggestion?.autoAcceptRecommended, true);
});
