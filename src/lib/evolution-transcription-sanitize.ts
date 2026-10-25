/**
 * Pós-processamento da transcrição técnica — remove redundâncias já presentes no cabeçalho do formulário.
 */

export type EvolutionExtractedFields = {
  nome?: string;
  idade?: string;
  diagnostico?: string;
  technicalTranscription?: string;
  transcricao_corrigida?: string;
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeLine(line: string): string {
  return line
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

const DROP_LINE_PATTERNS: RegExp[] = [
  /^evolucao\s+(clinica\s+)?fisioterapeut/i,
  /^evolucao\s+clinica\b/i,
  /^identificacao(\s+do\s+paciente)?\s*:?\s*$/i,
  /^dados\s+do\s+paciente\s*:?\s*$/i,
  /^paciente:\s*/i,
  /^idade:\s*/i,
  /^perfil:\s*/i,
  /^sexo:\s*/i,
  /^nome:\s*/i,
];

const SECTION_START_PATTERNS: RegExp[] = [
  /^historia\s+(da\s+)?(doenca|molestia)/i,
  /^hma\b/i,
  /^queixa\s+principal/i,
  /^anamnese/i,
  /^exame\s+fisico/i,
  /^conduta/i,
  /^plano\s+terapeutico/i,
  /^objetivos?\s+terapeuticos?/i,
  /^intervencao/i,
  /^evolucao\s+do\s+dia/i,
];

const IDENT_BODY_LINE_PATTERNS: RegExp[] = [
  /^paciente\s*,\s*\d{1,3}\s*anos/i,
  /^paciente\s+de\s+\d{1,3}\s*anos/i,
  /^sexo\s+(masculino|feminino)/i,
  /^(praticante|atleta|amador|profissional)\b/i,
  /^(ocupacao|profissao)\s*:/i,
];

function isIdentificationBodyLine(normalized: string): boolean {
  return IDENT_BODY_LINE_PATTERNS.some((re) => re.test(normalized));
}

function isSectionStart(normalized: string): boolean {
  return SECTION_START_PATTERNS.some((re) => re.test(normalized));
}

function shouldDropLine(normalized: string): boolean {
  if (!normalized) return false;
  return DROP_LINE_PATTERNS.some((re) => re.test(normalized));
}

/**
 * Remove título da evolução, bloco IDENTIFICAÇÃO e dados demográficos do corpo narrativo.
 */
export function sanitizeTechnicalNarrative(
  raw: string | undefined,
  nome?: string,
  idade?: string,
): string {
  if (!raw?.trim()) return "";

  const rawLines = raw.split(/\r?\n/);
  const kept: string[] = [];
  let inIdentBlock = false;

  for (const line of rawLines) {
    const normalized = normalizeLine(line);
    if (!normalized) {
      if (!inIdentBlock) kept.push("");
      continue;
    }

    if (shouldDropLine(normalized)) {
      if (/^identificacao/.test(normalized) || /^dados\s+do\s+paciente/.test(normalized)) {
        inIdentBlock = true;
      }
      continue;
    }

    if (inIdentBlock) {
      if (isSectionStart(normalized)) {
        inIdentBlock = false;
        kept.push(line.trimEnd());
      }
      continue;
    }

    const identPrefix =
      /^paciente\s*,\s*\d{1,3}\s*anos\s*,?\s*/i.test(line) ||
      /^paciente\s+de\s+\d{1,3}\s*anos\s*,?\s*/i.test(line);
    if (identPrefix) {
      const rest = line
        .replace(/^paciente\s*,\s*\d{1,3}\s*anos\s*,?\s*/i, "")
        .replace(/^paciente\s+de\s+\d{1,3}\s*anos\s*,?\s*/i, "")
        .trim();
      if (rest && !isIdentificationBodyLine(normalizeLine(rest))) {
        kept.push(rest);
      }
      continue;
    }

    if (isIdentificationBodyLine(normalized)) continue;

    kept.push(line.trimEnd());
  }

  let out = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  if (nome?.trim()) {
    const nomeEsc = escapeRegExp(nome.trim());
    out = out.replace(new RegExp(`^paciente\\s+${nomeEsc}\\s*,?\\s*`, "i"), "");
    out = out.replace(new RegExp(`^${nomeEsc}\\s*,?\\s*`, "i"), "");
  }

  out = out.replace(/^paciente\s*,\s*\d{1,3}\s*anos[^.\n]*[.,]?\s*/i, "");
  out = out.replace(/^paciente\s+de\s+\d{1,3}\s*anos[^.\n]*[.,]?\s*/i, "");

  if (idade?.trim()) {
    const idadeEsc = escapeRegExp(idade.trim());
    out = out.replace(new RegExp(`^${idadeEsc}\\s*,?\\s*`, "i"), "");
  } else {
    out = out.replace(/^\d{1,3}\s*anos\s*,?\s*/i, "");
  }

  return out.trim();
}

/**
 * Remove menções de preço, pagamento e valores monetários do corpo clínico.
 * Sessões/plano de tratamento podem permanecer; dinheiro só vai para Serviços/Fiscal.
 * Cirúrgico: não apaga a frase clínica inteira só porque o final cita pagamento.
 */
export function stripFinancialMentionsFromClinicalText(raw: string): string {
  if (!raw?.trim()) return raw;

  let out = raw;

  // Cláusulas de pagamento no meio/fim da frase clínica.
  out = out.replace(
    /,?\s*(?:com\s+)?(?:a\s+)?(?:o\s+)?valor\s+(?:ja\s+|já\s+)?pago\.?/gi,
    "",
  );
  out = out.replace(
    /,?\s*(?:e\s+)?(?:o\s+)?pagamento\s+(?:foi\s+)?(?:realizado|efetuado|confirmado|recebido)\.?/gi,
    "",
  );
  out = out.replace(
    /,?\s*(?:ja\s+|já\s+)?(?:pago|pagou)\s+(?:via|no|na|com|em)\s+\w+\.?/gi,
    "",
  );
  out = out.replace(/,?\s*pago\s+via\s+\w+\.?/gi, "");
  out = out.replace(/,?\s*via\s+(?:pix|cartao|cartão|ted|boleto)\b\.?/gi, "");
  out = out.replace(
    /,?\s*(?:ainda\s+)?(?:nao|não)\s+pag(?:ou|o)\.?/gi,
    "",
  );
  out = out.replace(
    /,?\s*(?:forma\s+de\s+pagamento|meio\s+de\s+pagamento)\s*[:=]?\s*\w+\.?/gi,
    "",
  );

  // Frases cujo conteúdo é só financeiro (ex.: "Valor pago via Pix.").
  out = out.replace(
    /(?:^|\n)\s*(?:valor\s+pago|pagamento\s+(?:realizado|efetuado|confirmado|recebido)|pagou\s+(?:via|no|na|com))\b[^.!?\n]*[.!]?\s*/gi,
    "\n",
  );

  // Montantes e rótulos monetários (mantém EVA 2/10 etc.).
  out = out.replace(/\bR\$\s*[\d.,]+(?:\s*(?:reais?))?/gi, "");
  out = out.replace(
    /\b(?:no\s+)?valor\s+(?:de\s+)?(?:R\$\s*)?[\d.,]+(?:\s*(?:reais?))?/gi,
    "",
  );
  out = out.replace(
    /\b(?:preco|preço|custo|tarifa)\s+(?:de\s+)?(?:R\$\s*)?[\d.,]+/gi,
    "",
  );
  out = out.replace(/\b[\d.,]+\s*reais\b/gi, "");

  out = out.replace(/\s+(?:e|com)\s*([.!?])/gi, "$1");
  out = out.replace(/\s{2,}/g, " ");
  out = out.replace(/\s+([,.;])/g, "$1");
  out = out.replace(/([,;]){2,}/g, "$1");
  out = out.replace(/\n{3,}/g, "\n\n");

  return out.trim();
}

/** Garante que technicalTranscription e transcricao_corrigida ficam alinhados após sanitização. */
export function postProcessEvolutionTranscriptionFields<T extends EvolutionExtractedFields>(
  data: T,
): T {
  const cleaned = stripFinancialMentionsFromClinicalText(
    sanitizeTechnicalNarrative(
      data.technicalTranscription || data.transcricao_corrigida,
      data.nome,
      data.idade,
    ),
  );
  if (!cleaned) return data;
  return {
    ...data,
    technicalTranscription: cleaned,
    transcricao_corrigida: cleaned,
  };
}
