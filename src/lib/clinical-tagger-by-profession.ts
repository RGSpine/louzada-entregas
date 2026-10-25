/**
 * CLINICAL TAGGER por profissão do dropdown (`profession-options.ts`).
 * Garante que cada value do cadastro recebe instruções e exemplos
 * de termos guarda-chuva adequados à área (não só fisioterapia).
 */

import { professionOptions } from "@/lib/profession-options";

export type ClinicalTaggerFamily =
  | "fisioterapia_reab"
  | "psicologia"
  | "nutricao_medicina"
  | "enfermagem"
  | "odontologia"
  | "fonoaudiologia"
  | "veterinaria"
  | "generico";

function normalizeProfession(raw: string | null | undefined): string {
  return (raw ?? "")
    .normalize("NFD")
    // Combina diacríticos (U+0300–U+036F) — compatível com target ES5 (sem \p{M}).
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Mapeia o value/label do dropdown (e variantes) para a família do tagger. */
export function resolveClinicalTaggerFamily(
  profession: string | null | undefined,
): ClinicalTaggerFamily {
  const p = normalizeProfession(profession);
  if (!p) return "generico";

  if (
    p.includes("fisioterapeuta") ||
    p.includes("fisioterapia") ||
    p.includes("educacao fisica") ||
    p.includes("educador fisico") ||
    p.includes("terapeuta ocupacional") ||
    p.includes("terapia ocupacional")
  ) {
    return "fisioterapia_reab";
  }

  if (
    p.includes("psicologo") ||
    p.includes("psicologia") ||
    p.includes("psiquiatra") ||
    p.includes("psiquiatria")
  ) {
    return "psicologia";
  }

  if (p.includes("enfermeiro") || p.includes("enfermagem")) {
    return "enfermagem";
  }

  if (
    p.includes("nutricionista") ||
    p.includes("nutricao") ||
    p === "medico" ||
    p.includes("medico ") ||
    p.startsWith("medico") ||
    p.includes("medicina") ||
    p.includes("clinico geral")
  ) {
    return "nutricao_medicina";
  }

  if (
    p.includes("dentista") ||
    p.includes("odontolog") ||
    p.includes("cirurgiao dentista")
  ) {
    return "odontologia";
  }

  if (p.includes("fonoaudiologo") || p.includes("fonoaudiologia")) {
    return "fonoaudiologia";
  }

  if (p.includes("veterinario") || p.includes("veterinaria")) {
    return "veterinaria";
  }

  // Estudante e demais → genérico (ainda com regras de guarda-chuva)
  return "generico";
}

const REGRAS_GERAIS = `
REGRAS CRITICAS PARA CLINICAL TAGGER:
1. EXTRAIA APENAS O DIAGNOSTICO PRINCIPAL - NAO extraia tratamentos/condutas/procedimentos
2. O campo "diagnostico" e OBRIGATORIO - preencha com o QUADRO CLINICO, nunca com regiao anatomica
3. Use o NOME DA CONDICAO CLINICA, nao o local anatomico (ex: "Tendinopatia" e nao "Ombro")
4. Simplifique para o TERMO GUARDA-CHUVA mais abrangente da AREA do profissional
5. Remova codigos CID-10 APENAS nos campos curtos do clinicalMeta — use termo guarda-chuva sem codigo
6. Use 1-2 palavras (maximo 24 caracteres)
7. NAO COLOQUE no diagnostico: nomes de musculos, regioes anatomicas puras, tratamentos, tecnicas
8. Se nao houver diagnostico claro, deixe o campo VAZIO
`;

const FAMILY_INSTRUCTIONS: Record<ClinicalTaggerFamily, string> = {
  fisioterapia_reab: `
EXTRACAO DE METADADOS CLINICOS (CLINICAL TAGGER):
${REGRAS_GERAIS}

Area: Fisioterapia / Educacao Fisica / Terapia Ocupacional.

Extraia do DIAGNOSTICO/CONCLUSAO e preencha:
"clinicalMeta": {
  "diagnostico": "OBRIGATORIO - QUADRO CLINICO (ex: Tendinopatia, Lombalgia, Artropatia, Bursite, Lesao Ligamentar, Fasciopatia Plantar, Sindrome Miofascial, Neuropatia, Fratura, Lesao Muscular, Fibromialgia, Capsulite Adesiva, Lesao Manguito Rotador, Sindrome Patelofemoral, Pos-Operatorio, AVC, Parkinson, Paralisia Cerebral, Esclerose Multipla)",
  "regiao": "regiao anatomica APENAS se complementar (ex: Ombro, Joelho, Tornozelo)"
}

- CORRETO: "diagnostico": "Tendinopatia", "regiao": "Ombro"
- ERRADO: "diagnostico": "Coluna Lombar"
- Sem diagnostico especifico com dor: "Sindrome Dolorosa"
`,

  psicologia: `
EXTRACAO DE METADADOS CLINICOS (CLINICAL TAGGER):
${REGRAS_GERAIS}

Area: Psicologia / Psiquiatria.

Extraia do DIAGNOSTICO/CONCLUSAO e preencha:
"clinicalMeta": {
  "diagnostico": "OBRIGATORIO - QUADRO (ex: Depressao, Ansiedade, TDAH, Burnout, Luto, Transtorno do Panico, TOC, TEPT, Transtorno Alimentar, TEA, Dependencia Quimica, Transtorno Bipolar, Esquizofrenia)"
}

- "Transtorno depressivo maior" -> "Depressao"
- "TAG" / ansiedade generalizada -> "Ansiedade"
- Nao use tecnicas (TCC, psicanalise) como diagnostico
`,

  nutricao_medicina: `
EXTRACAO DE METADADOS CLINICOS (CLINICAL TAGGER):
${REGRAS_GERAIS}

Area: Nutricao / Medicina.

Extraia do DIAGNOSTICO/CONCLUSAO e preencha:
"clinicalMeta": {
  "diagnostico": "OBRIGATORIO - Condicao principal (ex: Obesidade, Diabetes, Hipertensao, Dislipidemia, Doenca Renal, Tireopatia, Anemia, Doenca Hepatica, Cardiopatia, Asma, DPOC, Infeccao, Cefaleia, Gestacao)"
}

- "DM2 descompensado" -> "Diabetes"
- "HAS estagio 2" -> "Hipertensao"
- "esteatose hepatica" -> "Doenca Hepatica"
`,

  enfermagem: `
EXTRACAO DE METADADOS CLINICOS (CLINICAL TAGGER):
${REGRAS_GERAIS}

Area: Enfermagem.

Extraia do DIAGNOSTICO/CONCLUSAO e preencha:
"clinicalMeta": {
  "diagnostico": "OBRIGATORIO - Condicao/diagnostico de enfermagem ou clinico principal (ex: Lesao por Pressao, Ferida Operatoria, Infeccao, Sepse, Diabetes, Hipertensao, Insuficiencia Cardiaca, Desidratacao, Dor Cronica, Cuidados Paliativos)"
}

- Foque no problema de saude central do atendimento, nao no procedimento (curativo, sondagem)
`,

  odontologia: `
EXTRACAO DE METADADOS CLINICOS (CLINICAL TAGGER):
${REGRAS_GERAIS}

Area: Odontologia.

Extraia do DIAGNOSTICO/CONCLUSAO e preencha:
"clinicalMeta": {
  "diagnostico": "OBRIGATORIO - Condicao (ex: Carie, Doenca Periodontal, DTM, Maloclusao, Endodontia, Traumatismo Dentario)"
}
`,

  fonoaudiologia: `
EXTRACAO DE METADADOS CLINICOS (CLINICAL TAGGER):
${REGRAS_GERAIS}

Area: Fonoaudiologia.

Extraia do DIAGNOSTICO/CONCLUSAO e preencha:
"clinicalMeta": {
  "diagnostico": "OBRIGATORIO - Condicao (ex: Disfonia, Disfagia, Disturbio de Linguagem, Disturbio de Fala, Disturbio Auditivo, TEA)"
}
`,

  veterinaria: `
EXTRACAO DE METADADOS CLINICOS (CLINICAL TAGGER):
${REGRAS_GERAIS}

Area: Veterinaria.

Extraia do DIAGNOSTICO/CONCLUSAO e preencha:
"clinicalMeta": {
  "diagnostico": "OBRIGATORIO - Condicao (ex: Dermatopatia, Otite, Gastroenteropatia, Doenca Renal Cronica, Cardiopatia, Endocrinopatia, Displasia, Fratura)",
  "especie": "especie (ex: Canino, Felino, Equino)"
}
`,

  generico: `
EXTRACAO DE METADADOS CLINICOS (CLINICAL TAGGER):
${REGRAS_GERAIS}

Extraia do DIAGNOSTICO/CONCLUSAO e preencha:
"clinicalMeta": {
  "diagnostico": "OBRIGATORIO - condicao clinica em 1-2 palavras (o QUADRO, nao a regiao nem a conduta)"
}

Exemplos multiprofissionais validos: Tendinopatia, Depressao, Obesidade, Carie, Disfonia, Dermatopatia, Lesao por Pressao, Diabetes.
`,
};

/** Instrução completa do CLINICAL TAGGER para o prompt Gemini. */
export function getClinicalTaggingInstruction(
  profession: string | null | undefined,
): string {
  const family = resolveClinicalTaggerFamily(profession);
  return FAMILY_INSTRUCTIONS[family].trim();
}

/** Garante cobertura de todos os values do dropdown (para testes/auditoria). */
export function listProfessionTaggerCoverage(): Array<{
  value: string;
  label: string;
  family: ClinicalTaggerFamily;
}> {
  return professionOptions.map((opt) => ({
    value: opt.value,
    label: opt.label,
    family: resolveClinicalTaggerFamily(opt.value),
  }));
}
