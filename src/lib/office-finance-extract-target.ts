export type OfficeFinanceExtractTarget =
  | "auto"
  | "catalog"
  | "purchase"
  | "standalone"
  | "recurring";

export const OFFICE_FINANCE_EXTRACT_TARGETS = [
  "auto",
  "catalog",
  "purchase",
  "standalone",
  "recurring",
] as const satisfies readonly OfficeFinanceExtractTarget[];

export function parseOfficeFinanceExtractTarget(raw: unknown): OfficeFinanceExtractTarget {
  if (typeof raw === "string" && OFFICE_FINANCE_EXTRACT_TARGETS.includes(raw as OfficeFinanceExtractTarget)) {
    return raw as OfficeFinanceExtractTarget;
  }
  return "auto";
}

export function extractTargetPromptBlock(target: OfficeFinanceExtractTarget): string {
  switch (target) {
    case "catalog":
      return `
FOCO DESTE PEDIDO: cadastro de SERVIÇOS DE PRÓTESE no catálogo do laboratório (coroa, protocolo, lente, provisório, conserto), a partir de tabela de preços, proposta ou PDF.

recordType DEVE ser "catalog_service".

## Separação obrigatória (nome × valor × descrição)

1. **Nome** (professionalServiceGuess / name) — título curto do trabalho, SEM valores monetários.
   ✅ "Coroa em zircônia", "Protocolo sobre implante", "Conserto de prótese"
   ❌ "Coroa em zircônia (R$ 450,00)" — preço NUNCA no nome.

2. **Valor** (agreedAmountReais / price) — número em reais do trabalho à vista.
   Ex.: "À vista: R$ 450,00" → price: 450.
   Mensalidade de cliente do laboratório (ex. "R$ 600,00 mensais") → price: 600.

3. **Descrição** (serviceDescriptionGuess / description) — complemento curto: material, prazo de entrega, parcelas no crédito.
   Não descreva sessão, pacote de sessões, consulta nem paciente.

4. **packageSessionsGuess** — sempre null. **purchaseTypeGuess** — sempre "SINGLE".

## PDF com vários trabalhos

Devolva a chave **"services"** como array JSON — um objeto por trabalho visível.
Preencha também o **primeiro** item nos campos principais.

Formato de cada elemento em services:
{ "name": "Coroa em zircônia", "price": 450, "description": "Entrega em 5 dias úteis. Crédito: até 2x de R$ 240,00.", "packageSessionsGuess": null }

- NÃO inclua meta-texto sobre o documento; só linhas reais de serviço.
- Liste TODOS em "services".
`.trim();
    case "purchase":
      return `
FOCO DESTE PEDIDO: venda de trabalho de prótese a um cliente do laboratório (dentista ou clínica), ligada a uma coleta ou a uma entrega.
- recordType DEVE ser "patient_sale" quando houver cliente e valor de trabalho (coroa, protocolo, peça, conserto).
- saleActionGuess: sempre "new_sale". Nunca "mark_sessions_done".
- purchaseTypeGuess: sempre "SINGLE". packageSessionsGuess, performedSessionDatesGuess e performedSessionsCountGuess: sempre null.
- O cliente é quem pede a prótese, não um paciente clínico. "Coleta" e "entrega" indicam o movimento da peça, não uma consulta.
- occurredDateGuess = data do recebimento ou da entrega citada.
- paymentMethodGuess e installmentCountGuess: se o áudio citar PIX, dinheiro, crédito, débito ou "em Nx", preencha (CARD + installmentCountGuess para crédito parcelado).
`.trim();
    case "standalone":
      return `
FOCO DESTE PEDIDO: lançamento avulso de receita ou despesa do laboratório (material, motoboy, combustível, frete), sem venda de catálogo.
- recordType DEVE ser "standalone_transaction".
- Gasto variável vale o mês civil da data (occurredDateGuess). Não invente recorrência nem paciente.
`.trim();
    case "recurring":
      return `
FOCO DESTE PEDIDO: gasto fixo recorrente (aluguel, software, contador…).
- recordType DEVE ser "recurring_expense" quando houver despesa periódica.
- recurringNameGuess = nome (ex.: Aluguel); categoryGuess = categoria; agreedAmountReais = valor por período;
  frequencyGuess = WEEKLY | MONTHLY | YEARLY; anchorDayGuess = dia do mês (1-28) ou dia da semana (1=seg…7=dom) se semanal.
`.trim();
    default:
      return `
Inferir o tipo entre patient_sale (trabalho de prótese para um cliente, coleta ou entrega), standalone_transaction, catalog_service, recurring_expense ou unclear. Sem sessão, sem pacote e sem paciente clínico.
`.trim();
  }
}
