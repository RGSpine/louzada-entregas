/**
 * Tipos de documento clínico gerados por IA — chaves estáveis + rótulos PT-BR + instruções de layout/prompt.
 */

export const CLINICAL_DOCUMENT_TYPE_KEYS = [
  "PEDIDO_EXAMES",
  "RECIBO",
  "LAUDO",
  "PLANO_ALIMENTAR",
  "ATESTADO",
  "DECLARACAO_COMPARECIMENTO",
  "RELATORIO",
  "ENCAMINHAMENTO",
  "OUTRO",
] as const;

export type ClinicalDocumentTypeKey = (typeof CLINICAL_DOCUMENT_TYPE_KEYS)[number];

export const CLINICAL_DOCUMENT_TYPE_LABELS: Record<ClinicalDocumentTypeKey, string> = {
  PEDIDO_EXAMES: "Pedido de Exame",
  RECIBO: "Recibo",
  LAUDO: "Laudo clínico",
  PLANO_ALIMENTAR: "Plano alimentar",
  ATESTADO: "Atestado",
  DECLARACAO_COMPARECIMENTO: "Declaração de comparecimento",
  RELATORIO: "Relatório clínico",
  ENCAMINHAMENTO: "Encaminhamento",
  OUTRO: "Outro documento",
};

export function isClinicalDocumentTypeKey(
  v: string
): v is ClinicalDocumentTypeKey {
  return (CLINICAL_DOCUMENT_TYPE_KEYS as readonly string[]).includes(v);
}

/**
 * Tipos em que «Revisar com IA» pode enriquecer rascunho curto com evoluções do paciente.
 * RECIBO excluído (contexto financeiro, não clínico).
 */
export const CLINICAL_DOCUMENT_TYPES_EVOLUTION_ASSIST: readonly ClinicalDocumentTypeKey[] = [
  "PEDIDO_EXAMES",
  "LAUDO",
  "RELATORIO",
  "ENCAMINHAMENTO",
  "OUTRO",
  "ATESTADO",
  "DECLARACAO_COMPARECIMENTO",
  "PLANO_ALIMENTAR",
];

export function isEvolutionAssistDocumentType(type: ClinicalDocumentTypeKey): boolean {
  return (CLINICAL_DOCUMENT_TYPES_EVOLUTION_ASSIST as readonly string[]).includes(type);
}

/** Orientação curta para expandir rascunho a partir de evoluções (revisão com IA). */
/** RECIBO não usa resumo clínico das evoluções (contexto financeiro). */
export function documentTypeSupportsEvolutionClinicalSummary(
  type: ClinicalDocumentTypeKey
): boolean {
  return type !== "RECIBO";
}

/**
 * Instruções para a IA gerar o rascunho a partir só das evoluções + ficha,
 * alinhado ao tipo de documento (dropdown «Gerar documento»).
 */
export function getEvolutionClinicalSummaryFormatInstructions(
  type: ClinicalDocumentTypeKey
): string | null {
  if (type === "RECIBO") return null;

  const noInv =
    "Use apenas factos presentes nas evoluções ou na ficha; não invente datas, valores de exame, diagnósticos ou episódios não documentados.";

  switch (type) {
    case "PEDIDO_EXAMES":
      return `Formato alvo: PEDIDO DE EXAME (texto-base para o PDF).
Estruture em secções claras em texto corrido ou linhas simples (sem markdown):
1) QUADRO CLÍNICO / HIPÓTESE: resumo do que as evoluções sustentam.
2) JUSTIFICATIVA DO PEDIDO: por que pedir exames, com base nas notas.
3) EXAMES SOLICITADOS: lista numerada apenas de exames explicitamente mencionados nas evoluções como pedidos ou desejados; se não houver nenhum explícito, uma linha: «Exames a complementar pelo profissional.» (sem inventar painéis).
${noInv}`;
    case "LAUDO":
      return `Formato alvo: LAUDO / PARECER (texto-base).
Estruture: introdução breve; quadro clínico e antecedentes relevantes extraídos das evoluções; achados ou evolução descrita nas notas; discussão sucinta quando houver material; conclusão ou impressão apenas se sustentada pelo texto. Sem método de laboratório inventado.
${noInv}`;
    case "PLANO_ALIMENTAR":
      return `Formato alvo: PLANO ALIMENTAR (texto-base).
Inclua: objectivos nutricionais inferíveis do contexto clínico descrito; orientações dietéticas só quando as evoluções mencionem restrições, preferências ou prescrições; hidratação e observações se constarem. Se faltar detalhe, use parágrafo curto «Detalhes a completar pelo nutricionista» em vez de inventar cardápios.
${noInv}`;
    case "ATESTADO":
      return `Formato alvo: ATESTADO (texto-base).
Redija uma declaração objetiva (aptidão, afastamento, necessidade de acompanhamento) apenas com o que as evoluções suportam. Não invente períodos de afastamento nem CID. Se não for possível atestar categoricamente, declare os factos observados («compareceu», «em acompanhamento», etc.) sem extrapolar.
${noInv}`;
    case "DECLARACAO_COMPARECIMENTO":
      return `Formato alvo: DECLARAÇÃO DE COMPARECIMENTO (texto-base).
Texto formal declarando comparecimento: use datas/horários/locais apenas se constarem nas evoluções; caso contrário indique «data/hora conforme registo clínico a completar» sem forjar valores.
${noInv}`;
    case "RELATORIO":
      return `Formato alvo: RELATÓRIO CLÍNICO (texto-base).
Estruture: identificação narrativa mínima (nome já pode ser omitido no corpo — o PDF prefixa ficha); história do problema; evolução do tratamento; avaliação actual; recomendações ou seguimento apenas se derivados das notas.
${noInv}`;
    case "ENCAMINHAMENTO":
      return `Formato alvo: ENCAMINHAMENTO (texto-base).
Inclua: destino ou especialidade se mencionados; motivo do encaminhamento; resumo do caso com dados relevantes das evoluções; urgência só se documentada. Se o destino não constar, «Especialidade a definir pelo profissional.»
${noInv}`;
    case "OUTRO":
      return `Formato alvo: DOCUMENTO CLÍNICO GERAL (texto-base).
Organize o resumo de forma formal e legível (parágrafos ou secções curtas com rótulos em MAIÚSCULAS numa linha), cobrindo queixa, história breve, conduta e plano descritos nas evoluções.
${noInv}`;
    default:
      return `Formato: documento formal em português brasileiro, coerente com o tipo selecionado e com o material das evoluções.
${noInv}`;
  }
}

export function getEvolutionAssistStructureHint(type: ClinicalDocumentTypeKey): string {
  switch (type) {
    case "PEDIDO_EXAMES":
      return "Pedido formal: justificativa clínica com base nas evoluções quando existir; lista numerada dos exames alinhada à frase do utilizador.";
    case "LAUDO":
      return "Laudo/parecer: quadro clínico e achados coerentes com o pedido e com o que consta nas evoluções.";
    case "RELATORIO":
      return "Relatório: história resumida, avaliação e recomendações coerentes com o pedido e com as evoluções.";
    case "ENCAMINHAMENTO":
      return "Encaminhamento: motivo, dados relevantes do caso e destino, com base nas evoluções quando aplicável.";
    case "ATESTADO":
      return "Atestado: declaração objetiva fundamentada no que as evoluções suportam; sem inventar períodos ou CIDs não mencionados.";
    case "DECLARACAO_COMPARECIMENTO":
      return "Declaração de comparecimento: dados factuais suportados pelas evoluções quando existirem.";
    case "PLANO_ALIMENTAR":
      return "Plano alimentar: objectivos e orientações alinhadas ao contexto clínico das evoluções quando relevante.";
    case "OUTRO":
      return "Documento clínico: estrutura clara e formal coerente com o pedido e com as evoluções.";
    default:
      return "Documento formal em português brasileiro, coerente com o tipo e com o material fornecido.";
  }
}

/** Instruções de estrutura e tom (referência a documentos formais brasileiros; não substitui parecer legal). */
export function getClinicalDocumentPromptPack(type: ClinicalDocumentTypeKey): string {
  const commonBase = `
Regras gerais:
- Português brasileiro, tom formal de prontuário/documento profissional.
- Não invente dados clínicos que não estejam no material fornecido.
- TEXTO-BASE SOBERANO: o bloco "Rascunho" enviado pelo profissional (após revisão na app) é a fonte de verdade do CORPO do documento. Preserve redação, ordem das frases, nomes completos, CPF/CNPJ, valores e datas tal como no rascunho. Permita apenas correções mínimas (ortografia, concordância, vírgulas) — não reescreva com sinónimos, não inverta a voz ("recebi" vs "declaro que recebi" só se o rascunho já o disser assim), não substitua MAIÚSCULAS/minúsculas por capricho. Modelos visuais em anexo: guia de estilo quando o rascunho for incompleto; se o rascunho já for um texto corrido completo, não o troque pela estrutura do modelo.
- Sem markdown (proibido *, **, #, - como bullet). Se o rascunho usar parágrafo único, mantenha parágrafo único; só use títulos em MAIÚSCULAS numa linha própria se o rascunho ou o tipo de documento claramente o exigirem.
- NÃO inclua data no corpo do documento (a data é inserida automaticamente no rodapé pelo sistema).
- NÃO inclua bloco de assinatura, nome do profissional, conselho ou número de registro (o rodapé com dados do profissional é gerado automaticamente pelo sistema).
- NÃO inclua saudações de encerramento como "Atenciosamente", "Cordialmente", "Sem mais" etc.
- O diagnóstico da ficha do paciente só deve ser mencionado se for clinicamente relevante ao conteúdo do texto-base fornecido pelo profissional. Se o diagnóstico registrado não tiver relação com o documento, omita-o.
- PROIBIDO na tua resposta: o bloco "IDENTIFICAÇÃO DO PACIENTE" com Nome/Idade (o servidor insere esse bloco no PDF com dados da ficha). Também proibidos rótulos soltos "PACIENTE" ou "IDADE" no topo, a frase "CONTEÚDO DO DOCUMENTO" ou título equivalente. O PDF mostra o título do tipo, depois identificação (exceto RECIBO) e o teu texto.
`;

  const patientIdentificationNote = `
- Identificação no PDF: para tipos com paciente, o sistema acrescenta automaticamente no topo do corpo o bloco "IDENTIFICAÇÃO DO PACIENTE" com nome e idade oficiais da ficha. Na tua saída, comece diretamente pelo conteúdo clínico do documento (sem repetir identificação).
`;

  const withPatientId = `${commonBase}${patientIdentificationNote}`;

  const packs: Record<ClinicalDocumentTypeKey, string> = {
    PEDIDO_EXAMES: `
${withPatientId}
Tipo: PEDIDO DE EXAME (o título no PDF segue o mesmo nome do tipo no menu: Pedido de Exame)
Estruture como solicitação formal: justificativa clínica resumida, lista numerada de exames solicitados, urgência se mencionada (a identificação do paciente é prefixada pelo sistema no PDF). Não inclua bloco de assinatura.
`,
    RECIBO: `
${commonBase}
Tipo: RECIBO
Em RECIBO, NÃO inclua secção "IDENTIFICAÇÃO DO PACIENTE", nem nome ou idade do utente no documento (mesmo que constem no contexto). O corpo deve reproduzir fielmente o rascunho (quem recebeu, CREFITO/CRM, valores, pagador, CPF, forma de pagamento, serviço) — não reordene nem reescreva em tom diferente. Não inclua data nem dados do emitente no corpo (inseridos automaticamente pelo sistema no rodapé).
`,
    LAUDO: `
${withPatientId}
Tipo: LAUDO ou PARECER
Estruture: introdução, método/materiais se aplicável, achados, discussão breve, conclusão ou impressão diagnóstica alinhada ao texto de entrada (sem afirmações não sustentadas).
`,
    PLANO_ALIMENTAR: `
${withPatientId}
Tipo: PLANO ALIMENTAR
Estruture: objetivos, distribuição de macronutrientes se dados existirem, refeições sugeridas, hidratação, observações e restrições explícitas do utilizador.
`,
    ATESTADO: `
${withPatientId}
Tipo: ATESTADO
Estruture: declaração objetiva de aptidão ou afastamento, período se mencionado, CID apenas se fornecido. Não inclua data nem identificação do profissional (inseridos automaticamente pelo sistema).
`,
    DECLARACAO_COMPARECIMENTO: `
${withPatientId}
Tipo: DECLARAÇÃO DE COMPARECIMENTO
Estruture: declaração de que o paciente compareceu em data/horário, local se fornecido, finalidade da consulta/sessão em linha genérica se aplicável.
`,
    RELATORIO: `
${withPatientId}
Tipo: RELATÓRIO CLÍNICO
Estruture: história resumida, avaliação, intervenções, evolução e recomendações conforme o conteúdo fornecido.
`,
    ENCAMINHAMENTO: `
${withPatientId}
Tipo: ENCAMINHAMENTO
Estruture: destino/especialidade, motivo do encaminhamento, dados relevantes do caso, urgência se aplicável.
`,
    OUTRO: `
${withPatientId}
Tipo: DOCUMENTO CLÍNICO GERAL
Adapte a estrutura ao conteúdo e ao propósito descrito pelo utilizador, mantendo formalidade e clareza.
`,
  };

  return packs[type];
}

/** Título central no PDF: alinhado ao rótulo do dropdown (CLINICAL_DOCUMENT_TYPE_LABELS), em maiúsculas. */
export function pdfTitleForDocumentType(type: ClinicalDocumentTypeKey): string {
  const map: Record<ClinicalDocumentTypeKey, string> = {
    PEDIDO_EXAMES: "PEDIDO DE EXAME",
    RECIBO: "RECIBO",
    LAUDO: "LAUDO / PARECER",
    PLANO_ALIMENTAR: "PLANO ALIMENTAR",
    ATESTADO: "ATESTADO",
    DECLARACAO_COMPARECIMENTO: "DECLARAÇÃO DE COMPARECIMENTO",
    RELATORIO: "RELATÓRIO CLÍNICO",
    ENCAMINHAMENTO: "ENCAMINHAMENTO",
    OUTRO: "DOCUMENTO CLÍNICO",
  };
  return map[type];
}
