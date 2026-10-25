/**
 * Harness clínico anti-alucinação (evolução, aprimorar com IA, resumo e tópicos do caso).
 *
 * Camadas: política de extração estrita no prompt → parâmetros determinísticos →
 * schema Zod com nulos → checagem determinística (zero-LLM) de siglas/métodos sem base na fonte.
 * Independe da rota de custo (Flash, Pro ou DeepSeek): todas usam a mesma política e parâmetros.
 */

import { z } from "zod";

export const CLINICAL_LLM_TEMPERATURE = 0;
export const CLINICAL_LLM_TOP_P = 0.1;

/** Parâmetros de amostragem para Gemini; temperatura/top-P não podem ser sobrescritos por `extra`. */
export function clinicalGenerationConfig<T extends Record<string, unknown>>(
  extra?: T,
): T & { temperature: number; topP: number } {
  return {
    ...(extra ?? ({} as T)),
    temperature: CLINICAL_LLM_TEMPERATURE,
    topP: CLINICAL_LLM_TOP_P,
  };
}

/** Parâmetros equivalentes para `callDeepSeekText`. */
export const CLINICAL_DEEPSEEK_SAMPLING = {
  temperature: CLINICAL_LLM_TEMPERATURE,
  topP: CLINICAL_LLM_TOP_P,
} as const;

/** Bloco único injetado em todos os prompts clínicos de extração/estruturação. */
export const CLINICAL_STRICT_EXTRACTION_POLICY = `
POLITICA DE EXTRACAO ESTRITA (OBRIGATORIA — prevalece sobre qualquer outra instrucao deste prompt):
FONTE: somente o que foi DITO no audio, ESCRITO pelo profissional ou LEGIVEL nos anexos desta requisicao (e a evolucao anterior, quando fornecida). Nada alem disso.
PERMITIDO (refinamento terminologico, sem acrescentar fato):
- Corrigir fonetica/ortografia e trocar termo leigo pelo termo tecnico EQUIVALENTE ao que foi dito (ex.: "dor na lombar" -> "lombalgia").
- CID-10 SOMENTE para condicao que o profissional NOMEOU explicitamente; na duvida, sem codigo.
- Reordenar, pontuar e agrupar o que foi dito.
PROIBIDO:
- Criar diagnostico, hipotese, CID de condicao nao nomeada, metodologia, conceito, tecnica, abordagem terapeutica, escala, teste, objetivo, meta, prognostico, frequencia, dose ou achado que nao estejam na fonte.
- Expandir sigla cujo significado nao foi dito: falado "CME" -> escreva "CME". Nunca invente o nome por extenso de sigla, metodo ou tecnica.
- Completar frase cortada, trecho inaudivel ou raciocinio interrompido. Trecho fragmentado: omita ou registre literalmente o que foi dito.
- Acrescentar conhecimento externo, literatura, justificativa, explicacao ou "conduta sugerida" que o profissional nao disse.
LACUNAS: categoria nao mencionada (queixa, diagnostico, conduta, exames, metas etc.) -> valor null nativo do JSON (sem aspas). NUNCA escreva "Nao informado", "N/A", "sem dados" nem texto generico para preencher campo; no texto corrido, simplesmente omita o topico.
LISTAS (pontos de acao, orientacoes, medicamentos): apenas itens ditos/escritos explicitamente; lista vazia quando nao houver.
`.trim();

const NOT_INFORMED_RE =
  /^(?:n[aã]o\s+(?:informad[oa]s?|mencionad[oa]s?|relatad[oa]s?|citad[oa]s?|especificad[oa]s?|identificad[oa]s?|consta|h[aá])|n\/?[ad]|null|undefined|nenhum[a]?|sem\s+(?:informa[cç](?:[aã]o|[oõ]es)|dados|registro)|-+|—+|\?+)\.?$/i;

/** Converte null/placeholder ("Não informado", "N/A"…) em string vazia; arrays viram lista "; ". */
export function normalizeNotInformed(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value
      .map((v) => normalizeNotInformed(v))
      .filter(Boolean)
      .join("; ");
  }
  if (typeof value !== "string" && typeof value !== "number") return "";
  const trimmed = String(value).trim();
  if (!trimmed) return "";
  return NOT_INFORMED_RE.test(trimmed) ? "" : trimmed;
}

const llmText = z.union([z.string(), z.number(), z.array(z.string())]).nullable().optional();

/** Campos centrais da evolução devolvidos pela LLM: ausência = null nativo. */
export const llmEvolutionCoreFieldsSchema = z
  .object({
    nome: llmText,
    idade: llmText,
    dataAtendimento: llmText,
    queixa: llmText,
    diagnostico: llmText,
    conduta: llmText,
    transcricao_corrigida: llmText,
    technicalTranscription: llmText,
    examsAnalysis: llmText,
    termosLiterais: z.array(z.string()).nullable().optional(),
    transcricaoLiteral: llmText,
  })
  .passthrough();

const EVOLUTION_CORE_TEXT_FIELDS = [
  "nome",
  "idade",
  "dataAtendimento",
  "queixa",
  "diagnostico",
  "conduta",
  "transcricao_corrigida",
  "technicalTranscription",
  "examsAnalysis",
] as const;

type EvolutionCoreTextField = (typeof EVOLUTION_CORE_TEXT_FIELDS)[number];

export type NormalizedLlmEvolutionCore = Record<EvolutionCoreTextField, string> & {
  termosLiterais: string[];
  /** Transcrição literal do áudio (chamada única); fonte do grounding, não volta ao cliente. */
  transcricaoLiteral: string;
  [key: string]: unknown;
};

/**
 * Valida o JSON da LLM e normaliza nulos/placeholders para "" (contrato de string da UI),
 * para que lacunas nunca sobrescrevam valores reais nos merges do cliente.
 */
export function normalizeLlmEvolutionCoreFields(
  raw: Record<string, unknown>,
): NormalizedLlmEvolutionCore {
  const parsed = llmEvolutionCoreFieldsSchema.safeParse(raw);
  const base: Record<string, unknown> = parsed.success ? parsed.data : raw;
  const out: Record<string, unknown> = { ...base };
  for (const key of EVOLUTION_CORE_TEXT_FIELDS) {
    out[key] = normalizeNotInformed(base[key]);
  }
  const literals = Array.isArray(base.termosLiterais) ? base.termosLiterais : [];
  out.termosLiterais = literals
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 80);
  out.transcricaoLiteral = normalizeNotInformed(base.transcricaoLiteral);
  return out as NormalizedLlmEvolutionCore;
}

/* ------------------------------------------------------------------ */
/* Checagem determinística de grounding                               */
/* ------------------------------------------------------------------ */

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function foldedHas(foldedSource: string, phrase: string): boolean {
  const f = fold(phrase);
  if (!f) return true;
  return ` ${foldedSource} `.includes(` ${f} `);
}

/** Siglas clínicas universais cuja expansão é normalização terminológica aceitável. */
const KNOWN_CLINICAL_ACRONYMS: Record<string, string[]> = {
  ADM: ["amplitude de movimento"],
  ATM: ["articulacao temporomandibular"],
  AVC: ["acidente vascular cerebral", "acidente vascular encefalico"],
  AVE: ["acidente vascular encefalico"],
  AVD: ["atividade de vida diaria", "atividades de vida diaria"],
  AVDS: ["atividades de vida diaria"],
  CID: ["classificacao internacional de doencas"],
  DM: ["diabetes mellitus"],
  DM2: ["diabetes mellitus tipo 2"],
  DNPM: ["desenvolvimento neuropsicomotor"],
  DORT: ["disturbio osteomuscular relacionado ao trabalho"],
  DPOC: ["doenca pulmonar obstrutiva cronica"],
  DRC: ["doenca renal cronica"],
  DTM: ["disfuncao temporomandibular"],
  ECG: ["eletrocardiograma"],
  EVA: ["escala visual analogica"],
  HAS: ["hipertensao arterial sistemica"],
  HMA: ["historia da molestia atual"],
  IAM: ["infarto agudo do miocardio"],
  ICC: ["insuficiencia cardiaca congestiva"],
  IMC: ["indice de massa corporal"],
  ITU: ["infeccao do trato urinario"],
  LCA: ["ligamento cruzado anterior"],
  LCP: ["ligamento cruzado posterior"],
  LER: ["lesao por esforco repetitivo", "lesoes por esforcos repetitivos"],
  PC: ["paralisia cerebral"],
  RM: ["ressonancia magnetica"],
  RPG: ["reeducacao postural global"],
  TAG: ["transtorno de ansiedade generalizada"],
  TC: ["tomografia computadorizada"],
  TCC: ["terapia cognitivo comportamental"],
  TCE: ["traumatismo cranioencefalico"],
  TDAH: [
    "transtorno do deficit de atencao e hiperatividade",
    "transtorno do deficit de atencao com hiperatividade",
  ],
  TEA: ["transtorno do espectro autista"],
  TENS: ["estimulacao eletrica nervosa transcutanea"],
  TEPT: ["transtorno de estresse pos traumatico"],
  TOC: ["transtorno obsessivo compulsivo"],
  USG: ["ultrassonografia"],
};

/** Siglas estruturais que a organização do texto pode introduzir sem afirmar fato clínico. */
const STRUCTURAL_ACRONYMS = new Set(["CID", "HMA", "HDA", "QP", "HPP", "ID", "PDF", "OK"]);

function isKnownExpansion(acronym: string, phrase: string): boolean {
  const known = KNOWN_CLINICAL_ACRONYMS[acronym.toUpperCase()];
  if (!known) return false;
  const f = fold(phrase);
  return known.some((k) => f === k || f.endsWith(` ${k}`));
}

function acronymInSource(source: string, foldedSource: string, acronym: string): boolean {
  if (new RegExp(`(?<![A-Za-z0-9])${acronym}(?![A-Za-z0-9])`).test(source)) return true;
  const known = KNOWN_CLINICAL_ACRONYMS[acronym.toUpperCase()];
  return Boolean(known?.some((k) => foldedHas(foldedSource, k)));
}

const CONNECTORS = new Set([
  "de", "da", "do", "das", "dos", "e", "em", "no", "na", "nos", "nas", "a", "o", "para",
]);
const WORD_RE = /[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]*/g;

/** Localiza as palavras imediatamente anteriores a "(SIGLA)" que formam a expansão. */
function expansionBefore(prefix: string, acronym: string): number | null {
  const letters = acronym.replace(/[^A-Z]/g, "").length;
  if (letters < 2 || !/[A-Za-zÀ-ÿ'-]\s*$/.test(prefix)) return null;
  const words = [...prefix.matchAll(WORD_RE)].map((m) => ({ text: m[0], index: m.index ?? 0 }));
  let content = 0;
  let start: number | null = null;
  for (let i = words.length - 1; i >= 0 && content < letters; i--) {
    const w = words[i]!;
    const between = prefix.slice(w.index + w.text.length, i === words.length - 1 ? prefix.length : words[i + 1]!.index);
    if (/[.,;:!?()\n]/.test(between)) break;
    if (!CONNECTORS.has(w.text.toLowerCase())) content++;
    start = w.index;
  }
  return content === letters ? start : null;
}

export type GroundingAudit = { text: string; warnings: string[] };

/**
 * Remove expansões de sigla que não estão na fonte: "Conceito de Maturação Essencial (CME)" → "CME"
 * e "CME (Conceito …)" → "CME", quando a sigla foi dita mas o nome por extenso não.
 */
export function collapseUngroundedAcronymExpansions(text: string, source: string): GroundingAudit {
  if (!text) return { text, warnings: [] };
  const foldedSource = fold(source);
  const warnings: string[] = [];
  let out = text;

  const trailing = [...out.matchAll(/\(\s*([A-Z][A-Z0-9]{1,6})\s*\)/g)].reverse();
  for (const m of trailing) {
    const acronym = m[1]!;
    const parenStart = m.index ?? 0;
    const start = expansionBefore(out.slice(0, parenStart), acronym);
    if (start == null) continue;
    const phrase = out.slice(start, parenStart).trim();
    if (!acronymInSource(source, foldedSource, acronym)) continue;
    if (foldedHas(foldedSource, phrase) || isKnownExpansion(acronym, phrase)) continue;
    out = `${out.slice(0, start)}${acronym}${out.slice(parenStart + m[0].length)}`;
    warnings.push(`Sigla «${acronym}» mantida como dita; expansão «${phrase}» removida (não estava no relato).`);
  }

  const leading = [...out.matchAll(/(?<![A-Za-z0-9])([A-Z][A-Z0-9]{1,6})\s*\(([^()]{3,90})\)/g)].reverse();
  for (const m of leading) {
    const acronym = m[1]!;
    const inner = m[2]!.trim();
    if (/^[A-Z]\d{2}/.test(inner) || !/[a-zà-ÿ]/.test(inner)) continue;
    if (!acronymInSource(source, foldedSource, acronym)) continue;
    if (foldedHas(foldedSource, inner) || isKnownExpansion(acronym, inner)) continue;
    const at = m.index ?? 0;
    out = `${out.slice(0, at)}${acronym}${out.slice(at + m[0].length)}`;
    warnings.push(`Sigla «${acronym}» mantida como dita; expansão «${inner}» removida (não estava no relato).`);
  }

  return { text: out, warnings: warnings.reverse() };
}

const METHOD_TRIGGERS = [
  "conceito", "conceitos", "metodo", "método", "metodos", "métodos", "metodologia",
  "tecnica", "técnica", "tecnicas", "técnicas", "abordagem", "protocolo", "escala",
  "teste", "programa", "terapia", "principio", "princípio", "modelo", "sistema",
];
const CAP_WORD = "[A-ZÀ-Ý][A-Za-zÀ-ÿ'-]+";
const METHOD_RE = new RegExp(
  `(?<![A-Za-zÀ-ÿ])(?:${METHOD_TRIGGERS.map((t) => `[${t[0]!.toUpperCase()}${t[0]}]${t.slice(1)}`).join("|")})` +
    `(?:\\s+(?:terap[eê]utic[oa]\\s+)?(?:de|da|do|dos|das|baseada?\\s+n[oa]s?))?\\s+` +
    `(${CAP_WORD}(?:\\s+(?:(?:de|da|do|e)\\s+)?${CAP_WORD}){0,4})`,
  "g",
);

/** Palavras genéricas que o modelo capitaliza sem nomear um método próprio. */
const GENERIC_NAME_WORDS = new Set([
  "terapeutica", "terapeutico", "clinica", "clinico", "funcional", "motor", "motora",
  "manual", "global", "geral", "inicial", "final", "especifica", "especifico", "ativa",
  "ativo", "passiva", "passivo", "convencional", "domiciliar", "fisioterapeutica",
  "fisioterapeutico", "individual", "integrada", "integrado", "multidisciplinar",
]);

function isHeadingLine(line: string): boolean {
  const letters = line.replace(/[^A-Za-zÀ-ÿ]/g, "");
  return letters.length >= 3 && letters === letters.toUpperCase();
}

/** Nomes próprios de método/técnica/escala e siglas presentes na saída mas ausentes da fonte. */
export function findUngroundedClinicalTerms(text: string, source: string): string[] {
  if (!text) return [];
  const foldedSource = fold(source);
  const found = new Set<string>();

  for (const line of text.split("\n")) {
    if (isHeadingLine(line)) continue;

    for (const m of line.matchAll(METHOD_RE)) {
      const name = m[1]!;
      const contentWords = fold(name)
        .split(" ")
        .filter((w) => w && !CONNECTORS.has(w));
      const missing = contentWords.some((w) => !GENERIC_NAME_WORDS.has(w) && !foldedHas(foldedSource, w));
      if (!missing) continue;
      const known = Object.keys(KNOWN_CLINICAL_ACRONYMS).some(
        (acr) => isKnownExpansion(acr, m[0]) && acronymInSource(source, foldedSource, acr),
      );
      if (!known) found.add(m[0].trim());
    }

    for (const m of line.matchAll(/(?<![A-Za-z0-9])([A-Z]{2,6}\d?)(?![A-Za-z0-9])/g)) {
      const acronym = m[1]!;
      if (STRUCTURAL_ACRONYMS.has(acronym) || /^[IVXLC]+$/.test(acronym)) continue;
      if (!acronymInSource(source, foldedSource, acronym)) found.add(acronym);
    }
  }
  return [...found];
}

/** Auditoria completa de um campo: colapsa expansões inventadas e sinaliza termos sem base. */
export function auditClinicalText(text: string, source: string): GroundingAudit {
  const collapsed = collapseUngroundedAcronymExpansions(text, source);
  const ungrounded = findUngroundedClinicalTerms(collapsed.text, source);
  return {
    text: collapsed.text,
    warnings: [
      ...collapsed.warnings,
      ...ungrounded.map((t) => `Termo «${t}» não aparece no relato — confira antes de salvar.`),
    ],
  };
}

/**
 * Audita vários campos com a mesma fonte. `mode: "collapse-only"` aplica apenas a remoção
 * de expansões (seguro quando a fonte é parcial, ex.: termos literais do áudio).
 */
export function auditClinicalFields<K extends string>(
  fields: Record<K, string>,
  source: string,
  mode: "full" | "collapse-only" = "full",
): { fields: Record<K, string>; warnings: string[] } {
  const out = { ...fields };
  const warnings = new Set<string>();
  if (!source.trim()) return { fields: out, warnings: [] };
  for (const key of Object.keys(fields) as K[]) {
    const value = fields[key];
    if (!value) continue;
    const audit =
      mode === "full"
        ? auditClinicalText(value, source)
        : collapseUngroundedAcronymExpansions(value, source);
    out[key] = audit.text;
    audit.warnings.forEach((w) => warnings.add(w));
  }
  return { fields: out, warnings: [...warnings] };
}

/** Tópicos do caso: mantém só bullets com base na fonte (após colapsar expansões inventadas). */
export function filterGroundedBullets(
  bullets: string[],
  source: string,
): { kept: string[]; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const bullet of bullets) {
    const { text } = collapseUngroundedAcronymExpansions(bullet, source);
    if (findUngroundedClinicalTerms(text, source).length > 0) dropped.push(bullet);
    else kept.push(text);
  }
  return { kept, dropped };
}

/** Palavras de redação de prontuário que o modelo acrescenta legitimamente ao organizar a fala. */
const SUPPORT_STOPWORDS = new Set([
  "a", "o", "as", "os", "um", "uma", "uns", "umas", "de", "da", "do", "das", "dos", "em", "no",
  "na", "nos", "nas", "por", "pelo", "pela", "para", "com", "sem", "sob", "sobre", "entre", "e",
  "ou", "que", "se", "ao", "aos", "como", "mais", "menos", "muito", "muita", "ja", "nao", "sim",
  "foi", "foram", "ser", "esta", "estao", "estava", "tem", "teve", "ha", "seu", "sua", "seus",
  "suas", "ele", "ela", "eles", "elas", "este", "esta", "esse", "essa", "isso", "isto", "apos",
  "durante", "quando", "onde", "tambem", "ainda", "bem", "cada", "todo", "toda", "todos", "todas",
  "paciente", "refere", "referiu", "relata", "relatou", "apresenta", "apresentou", "realizado",
  "realizada", "realizados", "realizadas", "realizou", "sessao", "sessoes", "atendimento",
  "evolucao", "evolui", "evoluiu", "regiao", "quadro", "conduta", "mantem", "mantido", "mantida",
  "orientado", "orientada", "orientacoes", "queixa", "principal", "clinico", "clinica", "hoje",
  "atual", "atualmente", "observa", "observado", "observada", "nota", "notado", "notada",
]);

function contentStems(text: string): string[] {
  return fold(text)
    .split(" ")
    .filter((w) => w.length >= 3 && !SUPPORT_STOPWORDS.has(w) && !/^\d+$/.test(w))
    .map((w) => w.slice(0, 5));
}

/**
 * Frases da saída com pouca correspondência lexical com a fonte (prefixo de 5 letras,
 * tolera "lombar"→"lombalgia"). Sinaliza frases inventadas sem sigla/nome próprio.
 * Conservador: só frases com ≥6 palavras de conteúdo e cobertura < 25%.
 */
export function findWeaklySupportedSentences(
  text: string,
  source: string,
  opts: { minContentWords?: number; minCoverage?: number } = {},
): string[] {
  if (!text.trim() || !source.trim()) return [];
  const minWords = opts.minContentWords ?? 6;
  const minCoverage = opts.minCoverage ?? 0.25;
  const sourceStems = new Set(contentStems(source));
  const weak: string[] = [];
  for (const raw of text.split(/(?<=[.!?])\s+|\n+/)) {
    const sentence = raw.trim();
    if (!sentence || isHeadingLine(sentence)) continue;
    const stems = contentStems(sentence);
    if (stems.length < minWords) continue;
    const covered = stems.filter((s) => sourceStems.has(s)).length;
    if (covered / stems.length < minCoverage) weak.push(sentence);
  }
  return weak;
}

/** Avisos legíveis para frases com pouca base na fonte (máx. 3). */
export function weakSentenceWarnings(text: string, source: string): string[] {
  return findWeaklySupportedSentences(text, source)
    .slice(0, 3)
    .map((s) => {
      const snippet = s.length > 90 ? `${s.slice(0, 89)}…` : s;
      return `Trecho sem correspondência clara no relato: «${snippet}» — confira antes de salvar.`;
    });
}

/** Corta texto em limite de frase, sem deixar frase pela metade para a LLM "completar". */
export function clipAtSentenceBoundary(text: string, maxChars: number): string {
  const clean = text.trim();
  if (clean.length <= maxChars) return clean;
  const slice = clean.slice(0, maxChars);
  const lastStop = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf(".\n"), slice.lastIndexOf("\n"));
  const cut = lastStop > maxChars * 0.4 ? slice.slice(0, lastStop + 1) : slice.slice(0, slice.lastIndexOf(" "));
  return `${cut.trim()} [trecho seguinte omitido]`;
}
