"use server";

import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { Part } from "@google/generative-ai";
import {
  getGeminiModel,
  generateContentSafe,
  generateContentSafeWithModelFallback,
  getAudioMultimodalModelIds,
  getDocumentMergeVisionModelIds,
} from "@/lib/gemini";
import { formatAiProviderErrorForUser } from "@/lib/ai-provider-user-message";
import {
  aiBillingRateLimitMessage,
  enforceAiBillingRateLimit,
} from "@/lib/ai-billing-rate-limit";
import { getRequestClientIp } from "@/lib/request-client-ip";
import { getAuthenticatedDbUserId } from "@/lib/patient-ownership";
import { getClinicalTaggingInstruction } from "@/lib/clinical-tagger-by-profession";
import {
  shouldTryEvolutionTwoPhaseFallback,
  generateEvolutionResponseViaTwoPhase,
} from "@/lib/evolution-llm-fallback";
import {
  approxBytesFromBase64,
  evolutionMultimodalTimeoutMs,
  hasUsableEvolutionTranscription,
  isLongEvolutionAudio,
} from "@/lib/evolution-long-audio";
import { generateTextWithDeepSeek, isDeepSeekConfigured } from "@/lib/deepseek";
import {
  postProcessEvolutionTranscriptionFields,
} from "@/lib/evolution-transcription-sanitize";
import {
  parseAndSanitizeEvolutionArtifacts,
  type MedicationsAndSupplementsStored,
  type PatientHandoutStored,
  type ProfessionalActionsStored,
} from "@/lib/evolution-artifacts";
import {
  PATIENT_OPTIONAL_CONTACTS_JSON_FIELDS,
  PATIENT_OPTIONAL_CONTACTS_PROMPT_RULE,
  parseOptionalContactsFromAi,
} from "@/lib/patient-optional-contacts";
import {
  auditClinicalFields,
  CLINICAL_DEEPSEEK_SAMPLING,
  CLINICAL_STRICT_EXTRACTION_POLICY,
  clinicalGenerationConfig,
  normalizeLlmEvolutionCoreFields,
  normalizeNotInformed,
  weakSentenceWarnings,
} from "@/lib/clinical-harness";
import { stripCommercialRegistrationActions } from "@/lib/evolution-commercial-plan";

/** Alinhado a .cursor/skills/evolution-professional-action-items/SKILL.md — manter sincronizado. */
const EVOLUTION_ARTEFACTOS_PROMPT_BLOCK = `
ARTEFACTOS (obrigatorio incluir as chaves; so use false e arrays vazios se NAO houver base no material — nao invente, mas NAO omita o que foi falado):
DEFINICAO DE professionalActions: pontos de acao do PROFISSIONAL obtidos por garimpo do audio interpretado, dos arquivos anexados e do texto da evolucao (conduta, technicalTranscription, transcricao_corrigida). Cada item e uma acao prescrita recomendada ou acordada no PRESENTE ou FUTURO proximo que o profissional deve lembrar agendar solicitar documentar ou acompanhar.
GATILHOS LINGUISTICOS (PT) → preencher professionalActions quando aparecerem (mesmo se embutidos na conduta):
"ponto(s) de acao", "acao do profissional", "eu preciso", "preciso marcar/solicitar/agendar", "vou solicitar", "lembrar de", "nao esquecer de", "minha tarefa", "tarefas minhas", "para mim fazer", "retorno em", "encaminhar para", "pedir exame", "solicitar relato", "registrar em planilha/prontuario", "acompanhar adesao", "reavaliar em".
DEFINICAO DE patientHandout (patientHandoutBullets + patientHandoutSummary): texto para o PACIENTE LER — cuidados domiciliares, sinais de alerta, adesao, exercicios em casa, o que evitar.
GATILHOS LINGUISTICOS (PT) → preencher patientHandout quando aparecerem:
"orientacao(oes) ao paciente", "orientar o paciente", "handout", "cuidados em casa", "em casa o paciente deve", "sinais de alerta", "procurar pronto-socorro se", "avise o paciente", "instrucoes ao paciente", "educacao ao paciente", "para o paciente fazer", "exercicios domiciliares", "gelo/repouso em casa".
SEPARACAO OBRIGATORIA: o que o PROFISSIONAL deve cumprir → professionalActions; o que o PACIENTE deve seguir/ler → patientHandout. Nunca deixar so na conduta/narrativa quando esses gatilhos existirem — espelhe tambem nos arrays.
NAO INCLUIR em professionalActions: texto para o paciente ler (use patientHandout); relato apenas passado sem proximo passo; diagnostico isolado sem acao associada; itens sem evidencia no material.
ORDEM DE GARIMPO: (1) falas e conduta no audio; (2) laudos ou anexos que indiquem EXPLICITAMENTE um proximo passo do profissional; (3) conduta e narrativa escrita da evolucao. Nunca deduza acao que nao foi dita/escrita. Deduplicar mesma acao entre fontes.
- hasProfessionalActions: true quando existir pelo menos UM item concreto com base no material; nao deixar tudo vazio por economia de resposta nem por copiar o exemplo JSON vazio.
- hasPatientEducation: true somente se houver orientacoes claras para o PACIENTE em linguagem simples.
- professionalActions: array de ate 20 objetos { "label": "texto curto", "type": "schedule_exam|message|spreadsheet|referral|nutrition_plan|custom", "rationale": "opcional", "priority": "low|medium|high", "dueHint": "opcional" }. NUNCA duplicar o conteudo de patientHandoutBullets.
- patientHandoutBullets: frases curtas para o PACIENTE (cuidados sinais de alerta adesao). Conteudo DIFERENTE de professionalActions.
- patientHandoutSummary: paragrafo opcional em linguagem acessivel para o paciente.
DEFINICAO DE medicationsAndSupplements: garimpar nomes de MEDICAMENTOS e SUPLEMENTOS (prescritos em uso ou mencionados) a partir do audio, anexos (receitas laudos rotulos) e texto da evolucao. Incluir dose frequencia via efeitos relatados interacoes e observacoes SOMENTE quando ditos/escritos no material — nunca preencher efeitos ou interacoes por conhecimento farmacologico externo. Nao inventar farmacos.
NAO INCLUIR em medicationsAndSupplements: orientacoes genericas de adesao sem nome do produto (use patientHandout); tarefas do profissional de "prescrever X" sem o farmaco ja citado (use professionalActions).
- hasMedicationsAndSupplements: true quando existir pelo menos UM nome concreto de medicamento ou suplemento no material.
- medicationsAndSupplements: array de ate 30 objetos { "name": "nome do farmaco ou suplemento", "kind": "medication|supplement|other", "dose": "opcional", "frequency": "opcional", "route": "opcional", "effects": "opcional", "interactions": "opcional", "notes": "opcional" }.
- medicationsAndSupplementsSummary: paragrafo opcional resumindo o contexto terapeutico (ex polifarmacia adesao).
DEFINICAO DE commercialCarePlan: se o profissional AFIRMA no audio/texto que o paciente CONTRATOU / COMPROU / FECHOU um plano ou pacote de N sessoes/atendimentos/consultas (ou que ESTA consulta e sessao de um plano ja contratado), ou cita servico do catalogo com valor/pagamento, preencha o objeto. Nao invente venda sem base no material.
FLUXO DE DADOS COMERCIAIS (OBRIGATORIO): venda/contratacao de plano, sessao avulsa, servico do catalogo, valor, preco, R$, Pix, cartao, dinheiro, transferencia, "pago", "nao pago", forma de pagamento e montantes vao EXCLUSIVAMENTE em commercialCarePlan. Esse objeto alimenta Serviços/Fiscal e Consultório Financeiro — NUNCA faz parte do documento da evolucao. NUNCA coloquem dinheiro/preco/status de pagamento/"contratou pacote por X"/"pagou no Pix" em technicalTranscription, transcricao_corrigida, conduta, queixa ou professionalActions.
Na narrativa clinica PODE constar contexto clinico do tratamento (ex.: "iniciou plano de N sessoes", "3a sessao do plano") SE o profissional mencionou — sem valor, sem "pago", sem forma de pagamento.
NAO colocar em professionalActions tarefas do tipo "cadastrar plano", "registrar pacote", "lembrar de vincular venda" — isso e commercialCarePlan (Serviços/Fiscal + Consultório Financeiro), nao checklist clinico.
- commercialCarePlan: objeto ou omitir. Campos: {
    "contracted": true|false,
    "purchaseType": "SINGLE"|"PACKAGE",
    "sessionCount": numero total do plano se citado,
    "serviceNameHint": "nome do servico se citado",
    "thisVisitIsPlanSession": true|false,
    "paymentReceived": true se afirma pagamento JA recebido; false se diz nao pago/pendente; omitir se ambiguo,
    "paymentMethod": "CASH"|"PIX"|"CARD"|"TRANSFER"|"OTHER" se citado (dinheiro=CASH; pix=PIX; credito/debito/cartao=CARD; TED/DOC/transferencia=TRANSFER),
    "amountReais": numero em reais se citado (ex.: 600 para R$ 600), sem inventar,
    "sessionsAlreadyDone": quantas sessoes o audio diz que JA ocorreram (inclui a de hoje se citada); so numero — NAO invente datas,
    "evidence": "trecho curto que fundamenta"
  }.
  Ex.: "contratou plano de 8 sessoes, pagou 600 no Pix, primeira sessao hoje" → contracted=true, purchaseType=PACKAGE, sessionCount=8, thisVisitIsPlanSession=true, paymentReceived=true, paymentMethod="PIX", amountReais=600, sessionsAlreadyDone=1; technicalTranscription SEM valor/Pix/"pago".
  Ex.: "fez a 3a sessao do plano, ainda nao pagou" → thisVisitIsPlanSession=true, sessionsAlreadyDone=3, paymentReceived=false.
IMPORTANTE SOBRE O EXEMPLO JSON: false e [] sao apenas placeholders do schema. Se o audio/texto citar acoes do profissional ou orientacoes ao paciente, PREENCHA has*=true e os arrays — nao copie os vazios do exemplo.
`;

/** Chaves JSON de artefactos no template de resposta (placeholders — ver bloco ARTEFACTOS). */
const EVOLUTION_ARTEFACTOS_JSON_PLACEHOLDERS = `"hasProfessionalActions": false,
  "hasPatientEducation": false,
  "hasMedicationsAndSupplements": false,
  "professionalActions": [],
  "patientHandoutBullets": [],
  "patientHandoutSummary": "",
  "medicationsAndSupplements": [],
  "medicationsAndSupplementsSummary": "",
  "commercialCarePlan": null`;
export interface ClinicalMeta {
  // Fisioterapia/Ed. Fisica/TO
  anatomia?: string;
  patologia?: string;
  intervencao?: string;
  // Psicologia/Psiquiatria
  humor?: string;
  tema_central?: string;
  abordagem?: string;
  // Nutricao/Medicina
  diagnostico_meta?: string;
  conduta_meta?: string;
  adesao?: string;
  // Odontologia/Fonoaudiologia
  regiao_foco?: string;
  procedimento?: string;
  // Veterinaria
  especie?: string;
  sistema?: string;
  // Campos genericos
  [key: string]: string | undefined;
}

export interface ExtractedPatientData {
  nome: string;
  idade: string;
  dataAtendimento?: string;
  queixa: string;
  diagnostico: string;
  conduta: string;
  telefone?: string;
  nomePai?: string;
  nomeMae?: string;
  nomeAcompanhante?: string;
  telefoneAcompanhante?: string;
  transcricao_corrigida: string;
  technicalTranscription?: string; // Transcricao tecnica (evolucao)
  examsAnalysis?: string; // Analise de exames complementares
  clinicalMeta?: ClinicalMeta; // Metadados clinicos extraidos pela IA
  /** Checklist / lembretes para o profissional (distinto do handout do paciente). */
  professionalActions?: ProfessionalActionsStored;
  /** Pontos-chave em linguagem acessível para o paciente. */
  patientHandout?: PatientHandoutStored;
  /** Medicamentos e suplementos mencionados (nome, dose, efeitos, interações). */
  medicationsAndSupplements?: MedicationsAndSupplementsStored;
  /** Plano/pacote comercial afirmado no áudio (venda ou sessão de plano). */
  commercialCarePlan?: {
    contracted?: boolean;
    purchaseType?: "SINGLE" | "PACKAGE";
    sessionCount?: number;
    serviceNameHint?: string;
    thisVisitIsPlanSession?: boolean;
    evidence?: string;
    paymentReceived?: boolean;
    paymentMethod?: "CASH" | "PIX" | "CARD" | "TRANSFER" | "OTHER";
    amountReais?: number;
    sessionsAlreadyDone?: number;
  };
  /** Avisos do harness clínico (siglas/métodos sem base na fonte). */
  groundingWarnings?: string[];
}

/**
 * Harness pós-LLM: nulos/placeholders → "" e auditoria de grounding contra a fonte.
 * `full` quando a fonte é o texto completo (revisão, transcrição em 2 fases);
 * `collapse-only` quando a fonte é parcial (termos literais declarados + evolução anterior).
 */
function applyClinicalGroundingHarness(
  raw: Record<string, unknown>,
  source: string,
  mode: "full" | "collapse-only",
): { data: ExtractedPatientData & Record<string, unknown>; groundingWarnings: string[] } {
  const { termosLiterais, transcricaoLiteral: _literal, ...core } =
    normalizeLlmEvolutionCoreFields(raw);
  const auditSource = [source, ...termosLiterais].filter(Boolean).join("\n");
  const { fields, warnings: termWarnings } = auditClinicalFields(
    {
      queixa: core.queixa,
      diagnostico: core.diagnostico,
      conduta: core.conduta,
      technicalTranscription: core.technicalTranscription,
      transcricao_corrigida: core.transcricao_corrigida,
      examsAnalysis: core.examsAnalysis,
    },
    auditSource,
    mode,
  );
  const warnings =
    mode === "full" && auditSource.trim()
      ? [
          ...termWarnings,
          ...weakSentenceWarnings(
            [fields.technicalTranscription, fields.conduta].filter(Boolean).join("\n"),
            auditSource,
          ),
        ]
      : termWarnings;
  if (warnings.length) {
    console.warn("[clinical-harness] termos sem base na fonte:", warnings.length);
  }
  return {
    data: { ...core, ...fields } as ExtractedPatientData & Record<string, unknown>,
    groundingWarnings: warnings,
  };
}

/** Extrai o primeiro objeto JSON balanceado (evita regex gananciosa com chaves dentro de strings). */
function attachOptionalContacts<T extends ExtractedPatientData & Record<string, unknown>>(
  raw: T,
): T {
  const contacts = parseOptionalContactsFromAi(raw);
  return {
    ...raw,
    telefone: contacts.telefone ?? "",
    nomePai: contacts.nomePai ?? "",
    nomeMae: contacts.nomeMae ?? "",
    nomeAcompanhante: contacts.nomeAcompanhante ?? "",
    telefoneAcompanhante: contacts.telefoneAcompanhante ?? "",
  };
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\" && inString) {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// Métricas clínicas estruturadas para a "Evolução Visual"
export interface VisualMetric {
  name: string; // Ex.: "Dor (EVA)", "Total SF-36", "Carga (kg)"
  value: number; // escala definida pelo nome/contexto (não limitada a 0–10)
  date: string; // ISO date (YYYY-MM-DD)
  sourceEvolutionId?: string;
}

// Funcao para revisar e organizar texto de evolucao com IA
export async function reviseEvolutionContent(
  content: string
): Promise<ExtractedPatientData | { error: string }> {
  try {
    // Buscar profissao do usuario logado
    let userProfession: string | null = null;
    let billingUserKey: string | null = null;
    try {
      const supabase = await createSupabaseServerClient();
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser?.email) {
        billingUserKey = authUser.email.toLowerCase();
        const userFromDb = await prisma.user.findUnique({
          where: { email: authUser.email },
          select: { profession: true },
        });
        userProfession = userFromDb?.profession || null;
      }
    } catch (e) {
      console.warn("[Revision] Nao foi possivel buscar dados do usuario:", e);
    }

    const hdrs = await headers();
    const rl = await enforceAiBillingRateLimit({
      userKey: billingUserKey,
      ip: getRequestClientIp(hdrs),
    });
    if (!rl.allowed) {
      return { error: aiBillingRateLimitMessage(rl.resetIn) };
    }

    const clinicalTaggingInstruction = getClinicalTaggingInstruction(userProfession);

    const systemInstruction = `Voce e um revisor de prontuario: organiza e corrige a evolucao clinica escrita pelo profissional, SEM acrescentar conteudo.
Sua tarefa e revisar o texto fornecido e:
1. Organizar o que foi escrito em ordem logica (queixa, achados, conduta) sem criar secoes vazias
2. Corrigir gramatica, ortografia e trocar termo leigo pelo termo tecnico equivalente ao que foi escrito
3. CID-10 apenas para condicoes que o profissional nomeou no texto
4. Manter TODAS as informacoes originais (nao remover nada) e NAO adicionar nenhuma informacao nova
5. Usar linguagem tecnica apropriada para prontuario
6. Extrair Pontos de Acao (profissional) e Orientacoes para o Paciente com a mesma rigorosidade do fluxo por audio — ver bloco ARTEFACTOS
${userProfession ? `Contexto: Profissional da area de ${userProfession}` : ''}

${CLINICAL_STRICT_EXTRACTION_POLICY}

${clinicalTaggingInstruction}`;

    const model = getGeminiModel({
      systemInstruction,
      generationConfig: clinicalGenerationConfig(),
    });

    const prompt = `Revise e organize o seguinte texto de evolucao clinica:

TEXTO ORIGINAL:
${content}

TAREFAS:
1. Extraia informacoes estruturadas (nome, idade, queixa, diagnostico, conduta, contatos opcionais) SOMENTE se estiverem no texto; senao null
2. Reescreva o texto de forma organizada e tecnica, com exatamente o mesmo conteudo clinico (nada a mais, nada a menos)
3. CID-10 apenas para condicoes nomeadas no texto
4. Siglas permanecem como escritas; nao expanda sigla cujo significado nao esteja no texto
5. Extraia metadados clinicos para o Clinical Tagger
6. Garimpe professionalActions e patientHandout a partir do TEXTO (conduta, evolucao, exames mencionados) — mesma definicao do fluxo por audio

FORMATO DE RESPOSTA (CRITICO):
Responda APENAS com um objeto JSON valido (use null nativo para o que nao estiver no texto):
{
  "nome": string ou null,
  "idade": string ou null,
  ${PATIENT_OPTIONAL_CONTACTS_JSON_FIELDS},
  "queixa": string ou null,
  "diagnostico": string ou null — CID-10 entre parenteses apos cada condicao NOMEADA no texto (ex: Ruptura do LCA (S83.5)); null se o texto nao nomeia condicao,
  "conduta": string ou null,
  "transcricao_corrigida": "texto revisado e organizado",
  "technicalTranscription": "texto revisado completo, profissional, sem markdown",
  "examsAnalysis": string ou null (somente exames citados no texto),
  "clinicalMeta": { ... metadados clinicos ... },
  ${EVOLUTION_ARTEFACTOS_JSON_PLACEHOLDERS}
}
${EVOLUTION_ARTEFACTOS_PROMPT_BLOCK}
${PATIENT_OPTIONAL_CONTACTS_PROMPT_RULE}`;

    let responseText: string;
    try {
      const result = await generateContentSafe(model, prompt, 90_000, 1);
      responseText = result.response.text();
    } catch (geminiErr) {
      if (isDeepSeekConfigured()) {
        console.warn(
          "[Revision] Gemini falhou; tentando DeepSeek:",
          geminiErr instanceof Error ? geminiErr.message : geminiErr,
        );
        responseText = await generateTextWithDeepSeek({
          systemInstruction,
          userPrompt: prompt,
          timeoutMs: 90_000,
          ...CLINICAL_DEEPSEEK_SAMPLING,
        });
      } else {
        throw geminiErr;
      }
    }

    let cleanedText = responseText
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleanedText = jsonMatch[0];
    }

    const raw = JSON.parse(cleanedText) as Record<string, unknown>;
    const { data: grounded, groundingWarnings } = applyClinicalGroundingHarness(raw, content, "full");
    const data = attachOptionalContacts(postProcessEvolutionTranscriptionFields(grounded));

    const { professionalActions, patientHandout, medicationsAndSupplements, commercialCarePlan } =
      parseAndSanitizeEvolutionArtifacts(raw);
    const filteredActions = stripCommercialRegistrationActions(
      professionalActions,
      commercialCarePlan,
    );

    return {
      ...data,
      ...(groundingWarnings.length ? { groundingWarnings } : {}),
      professionalActions: filteredActions,
      patientHandout,
      medicationsAndSupplements,
      commercialCarePlan,
    };
  } catch (error) {
    console.error("Erro na revisao com IA:", error);
    return {
      error: formatAiProviderErrorForUser(error),
    };
  }
}

export async function generateEvolution(
  audioBase64: string | null, // Agora pode ser null para processar apenas exames
  examFile?: { base64: string; mimeType: string; fileName: string } | null,
  examFiles?: { base64: string; mimeType: string; fileName: string }[] | string[],
  existingContent?: string, // Conteudo existente para merge inteligente
  audioMimeType?: string | null,
  audioDurationSec?: number | null,
  /** Última evolução do paciente: integrar só o que é novo, sem colar parágrafo. */
  clinicalContinuation?: boolean,
): Promise<ExtractedPatientData & { patientMessage?: string } | { error: string }> {
  try {
    const currentDateBr = new Date().toLocaleDateString("pt-BR");
    // Buscar profissao e ID do usuario logado
    let userProfession: string | null = null;
    let loggedUserId: string | null = null;
    let billingUserKey: string | null = null;
    try {
      const supabase = await createSupabaseServerClient();
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser?.email) {
        billingUserKey = authUser.email.toLowerCase();
        const userFromDb = await prisma.user.findUnique({
          where: { email: authUser.email },
          select: { id: true, profession: true },
        });
        loggedUserId = userFromDb?.id || null;
        userProfession = userFromDb?.profession || null;
        console.log(`[Clinical Tagger] Usuario: ${loggedUserId}, Profissao: ${userProfession || 'Nao definida'}`);
      }
    } catch (e) {
      console.warn("[Clinical Tagger] Nao foi possivel buscar dados do usuario:", e);
    }

    const hdrs = await headers();
    const rl = await enforceAiBillingRateLimit({
      userKey: billingUserKey ?? loggedUserId,
      ip: getRequestClientIp(hdrs),
    });
    if (!rl.allowed) {
      return { error: aiBillingRateLimitMessage(rl.resetIn) };
    }

    // NUNCA fazer JSON.stringify em objetos com base64 — duplica MB na RAM e pode derrubar o serverless (413/OOM/timeout).
    if (!examFiles || !Array.isArray(examFiles)) {
      console.log("[generateEvolution] examFiles: ausente ou não é array");
    } else {
      console.log(`[generateEvolution] examFiles: ${examFiles.length} item(ns)`);
      examFiles.forEach((item, idx) => {
        if (item && typeof item === "object" && item !== null && "base64" in item) {
          const o = item as { base64?: string; mimeType?: string; fileName?: string };
          console.log(
            `[generateEvolution]   [${idx}] file=${o.fileName ?? "?"} mime=${o.mimeType ?? "?"} base64Chars=${o.base64?.length ?? 0}`,
          );
        } else if (typeof item === "string") {
          console.log(`[generateEvolution]   [${idx}] string length=${item.length}`);
        } else {
          console.log(`[generateEvolution]   [${idx}] tipo=${typeof item}`);
        }
      });
    }

    // Validação de URL contra SSRF (Server-Side Request Forgery)
    const isUrlSafe = (urlStr: string): boolean => {
      try {
        const parsed = new URL(urlStr);
        if (!['http:', 'https:'].includes(parsed.protocol)) return false;
        const hostname = parsed.hostname.toLowerCase();
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0') return false;
        if (hostname.startsWith('10.') || hostname.startsWith('192.168.')) return false;
        if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return false;
        if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') return false;
        if (hostname.startsWith('169.254.')) return false;
        return true;
      } catch {
        return false;
      }
    };

    // Função auxiliar para baixar arquivo de URL e converter para base64 (PROCESSAMENTO VOLÁTIL - In-Memory)
    const downloadFileFromUrl = async (url: string): Promise<{ base64: string; mimeType: string } | null> => {
      try {
        if (!isUrlSafe(url)) {
          console.warn(`⚠️ [SECURITY] URL bloqueada por proteção SSRF: ${url}`);
          return null;
        }
        console.log(`🔍 [DEBUG] Processando URL: ${url}`);
        const response = await fetch(url);
        if (!response.ok) {
          console.warn(`⚠️ [WARN] Falha ao baixar arquivo de ${url}: ${response.status} ${response.statusText}`);
          return null;
        }
        
        // Download volátil: Buffer temporário em memória (será descartado pelo GC)
        const buffer: Buffer = Buffer.from(await response.arrayBuffer());
        const base64: string = buffer.toString('base64');
        
        // Determinar mimeType pela extensão (conforme especificação)
        const urlLower = url.toLowerCase();
        let mimeType: string;
        
        if (urlLower.endsWith('.pdf')) {
          mimeType = 'application/pdf';
        } else if (urlLower.endsWith('.png')) {
          mimeType = 'image/jpeg'; // Conforme especificação: .png/.jpg -> image/jpeg
        } else if (urlLower.endsWith('.jpg') || urlLower.endsWith('.jpeg')) {
          mimeType = 'image/jpeg';
        } else {
          // Fallback para outros tipos
          mimeType = response.headers.get('content-type') || 'image/jpeg';
        }
        
        console.log(`✅ [SUCESSO] Arquivo convertido. MimeType: ${mimeType}. Tamanho: ${buffer.length} bytes`);
        
        // Buffer será descartado automaticamente após o return (GC)
        return { base64, mimeType };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`❌ [ERRO] processando arquivo: ${errorMsg}`);
        return null;
      }
    };
    
    // Função auxiliar para processar base64 direto (data:image... ou string base64 pura)
    const processBase64String = (base64Str: string): { base64: string; mimeType: string } | null => {
      try {
        let cleanBase64: string;
        let mimeType: string = 'image/jpeg'; // Default
        
        if (base64Str.startsWith('data:')) {
          // É uma data URL (data:image/png;base64,...)
          const parts = base64Str.split(',');
          const mimeMatch = base64Str.match(/data:([^;]+)/);
          if (mimeMatch) {
            mimeType = mimeMatch[1];
          }
          cleanBase64 = parts[1] || parts[0];
        } else {
          // É base64 puro
          cleanBase64 = base64Str;
        }
        
        // Normalizar mimeType para image/jpeg se for imagem
        if (mimeType.startsWith('image/')) {
          mimeType = 'image/jpeg';
        }
        
        console.log(`✅ [SUCESSO] Base64 processado diretamente. MimeType: ${mimeType}. Tamanho: ${cleanBase64.length} caracteres`);
        return { base64: cleanBase64, mimeType };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`❌ [ERRO] processando base64: ${errorMsg}`);
        return null;
      }
    };
    
    // Processamento volátil de arquivos (In-Memory): verificar URLs e baixar para Buffer temporário
    // LÓGICA HÍBRIDA: suporta URL, base64 direto, ou objeto File/Blob
    const processedFiles: { base64: string; mimeType: string }[] = [];
    
    if (examFiles && Array.isArray(examFiles) && examFiles.length > 0) {
      console.log(`🔍 [DEBUG] Processando ${examFiles.length} arquivo(s) do array examFiles`);
      
      for (let idx = 0; idx < examFiles.length; idx++) {
        const item = examFiles[idx];
        console.log(`🔍 [DEBUG] Processando item ${idx}:`, typeof item);
        
        // Caso 1: String (URL ou base64 direto)
        if (typeof item === 'string') {
          // Verificar se é uma URL (http/https) ou base64 (data: ou string base64)
          if (item.startsWith('http://') || item.startsWith('https://')) {
            // É uma URL: baixar via fetch
            const downloaded = await downloadFileFromUrl(item);
            if (downloaded) {
              processedFiles.push(downloaded);
            }
          } else if (item.startsWith('data:') || item.length > 100) {
            // É base64 direto (data URL ou string base64 pura)
            const processed = processBase64String(item);
            if (processed) {
              processedFiles.push(processed);
            }
          } else {
            console.warn(`⚠️ [WARN] String não reconhecida como URL ou base64: ${item.substring(0, 50)}...`);
          }
        }
        // Caso 2: Objeto com base64
        else if (item && typeof item === 'object') {
          try {
            // Verificar se tem propriedade base64
            if (
              "base64" in item &&
              typeof item === "object" &&
              item !== null &&
              typeof (item as { base64?: unknown }).base64 === "string"
            ) {
              const obj = item as { base64: string; mimeType?: string };
              const cleanBase64 = obj.base64.includes(',') ? obj.base64.split(',')[1] : obj.base64;
              const mimeType = obj.mimeType || 'image/jpeg';
              
              console.log(`✅ [SUCESSO] Arquivo do objeto convertido. MimeType: ${mimeType}. Tamanho: ${cleanBase64.length} caracteres`);
              processedFiles.push({
                base64: cleanBase64,
                mimeType: mimeType
              });
            } else {
              console.warn(`⚠️ [WARN] Objeto sem propriedade 'base64':`, Object.keys(item));
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`❌ [ERRO] processando objeto: ${errorMsg}`);
          }
        }
        else {
          console.warn(`⚠️ [WARN] Item ${idx} ignorado. Tipo não suportado:`, typeof item);
        }
      }
    } else if (examFile) {
      // Compatibilidade com formato antigo
      console.log("🔍 [DEBUG] Processando examFile (formato antigo)");
      const cleanBase64 = examFile.base64.includes(',') ? examFile.base64.split(',')[1] : examFile.base64;
      processedFiles.push({
        base64: cleanBase64,
        mimeType: examFile.mimeType || 'image/jpeg'
      });
      console.log(`✅ [SUCESSO] examFile processado. MimeType: ${examFile.mimeType}. Tamanho: ${cleanBase64.length} caracteres`);
    }
    
    const filesToProcess = processedFiles;
    console.log(`🔍 [DEBUG] Total de arquivos processados com sucesso: ${filesToProcess.length}`);
    
    // Obter instrucoes de Clinical Tagger baseadas na profissao
    const clinicalTaggingInstruction = getClinicalTaggingInstruction(userProfession);
    
    // System Instruction com regras de codificacao CID-10 e Clinical Tagger
    const systemInstruction = `Voce e um assistente medico especializado em extrair informacoes estruturadas de relatos de evolucao medica e corrigir textos medicos.

CONTEXTO: Voce e um assistente especialista em saude${userProfession ? `, com foco em ${userProfession}` : ''}.
TAREFA: Transcrever audios clinicos com precisao terminologica e extrair metadados estruturados, sem acrescentar nada que nao tenha sido dito.

${CLINICAL_STRICT_EXTRACTION_POLICY}

REGRA CRITICA DE SEGURANCA CLINICA - CONTEXTO HUMANO vs VETERINARIO (OBRIGATORIA):

DEFINICAO DE ESTADO PADRAO (DEFAULT):
- Por padrao, considere que o atendimento e de SAUDE HUMANA.
- Use terminologia medica padrao (Paciente, CID-10).
- Use o termo "Paciente" para se referir a pessoa atendida.
- Use codigos CID-10 (padrao brasileiro DATASUS) para diagnosticos.

GATILHOS DE EXCECAO (VETERINARIA):
- Mude para o contexto VETERINARIO (CID-Vet, termo "Tutor") APENAS SE o texto contiver explicitamente um dos seguintes termos ou seus plurais:
  * "pet", "pets"
  * "animal", "animais"
  * "cachorro", "cachorros"
  * "cao", "caes"
  * "gato", "gatos"
  * "felino", "felinos"
  * "ave", "aves"
  * "roedor", "roedores"
  * OU se for mencionado o nome de uma raca animal reconhecida (ex: "Golden Retriever", "Persa", "Nelore", "Bulldog", "Siamese", "Poodle", etc.).

REGRA DE DESEMPATE (SAFEGUARD):
- Se houver ambiguidade (ex: o medico usa uma metafora animal como "paciente com forca de leao" ou "coragem de tigre"), MANTENHA O CONTEXTO HUMANO.
- Nunca use o termo "Tutor" ou codigos CID-Vet se os gatilhos acima nao estiverem presentes.
- Em caso de duvida, SEMPRE opte pelo contexto HUMANO.
- NUNCA assuma que um atendimento e veterinario baseando-se apenas em termos vagos ou metaforas.

REGRA DE CODIFICACAO CID-10 (IMPORTANTE):
Ao identificar diagnosticos, sintomas ou condicoes medicas EFETIVAMENTE MENCIONADOS, insira o codigo CID-10 correspondente entre parenteses. Use o padrao brasileiro (DATASUS). O CID normaliza o que foi dito; nunca acrescenta condicao nova.

CAMPO JSON "diagnostico":
- Liste cada condicao ou hipotese diagnostica mencionada no audio com CID-10 entre parenteses.
- Se nenhuma condicao/hipotese foi dita ou escrita, devolva null (nao deduza diagnostico dos sintomas).
- Formato: "Condicao clinica (CID); Outra condicao (CID)" — separar por ponto e virgula quando houver mais de uma.
- Exemplo: "Ruptura do ligamento cruzado anterior (S83.5); Lesao do menisco medial (S83.2); Pos-operatorio de joelho (Z96.6)"

NARRATIVA tecnica (technicalTranscription):
- Ao mencionar diagnosticos na narrativa, inclua o CID-10 entre parenteses apos o termo.

Exemplos obrigatorios:
- Falado: 'Paciente com muita dor na lombar' -> Transcreva: 'Paciente com Lombalgia (M54.5)'
- Falado: 'Sofreu um AVC ano passado' -> Transcreva: 'Sofreu um Acidente Vascular Cerebral (I64)'
- Falado: 'Rompimento de LCA' -> Transcreva: 'Ruptura do Ligamento Cruzado Anterior (S83.5)'
- Falado: 'Lesao em alca de balde do menisco' -> Transcreva: 'Lesao do menisco em alca de balde (S83.2)'
- Falado: 'Pos-operatorio de LCA' -> Transcreva: 'Pos-operatorio de reconstrucao do LCA (Z96.6 ou S83.5 conforme contexto)'

Se o termo for generico demais e voce nao tiver certeza absoluta do codigo, transcreva apenas o termo medico sem inventar codigos.

REGRA DE SEPARACAO CABECALHO vs CORPO (OBRIGATORIA):
Os campos JSON nome, idade, queixa, diagnostico e conduta preenchem o CABECALHO do formulario.
O campo technicalTranscription e APENAS o CORPO narrativo clinico (anamnese, HMA, exame, evolucao, conduta detalhada).
PROIBIDO em technicalTranscription/transcricao_corrigida:
- Titulos de documento ("EVOLUCAO FISIOTERAPUTICA", "EVOLUCAO CLINICA")
- Secao "IDENTIFICACAO" ou dados demograficos (nome, idade, sexo, ocupacao, esporte/hobby)
- Repetir nome ou idade do paciente no inicio do texto
- Qualquer mencao a valor, preco, R$, Pix, cartao, "valor pago", "ja pago", "nao pago" ou status financeiro (isso vai so em commercialCarePlan / Serviços-Fiscal)
PERMITIDO na narrativa: paciente iniciou plano/tratamento de N sessoes/atendimentos SE mencionado no audio — sem montante nem pagamento.
Comece direto pela HMA/anamnese ou pelo relato clinico principal.

REGRA DE DATA DO ATENDIMENTO (OBRIGATORIA):
- Extraia a data do atendimento quando houver mencao explicita no audio/relato/anexos (ex.: "23/04/2026", "23-04-2026", "23 de abril de 2026", "ontem", "anteontem", "hoje").
- Devolva essa data no campo "dataAtendimento" no formato DD/MM/AAAA.
- Se nao houver mencao de data, use a data atual (${currentDateBr}) em "dataAtendimento".
- Nao invente datas futuras.

INSTRUCAO FINAL - EXAMES ANEXOS:
Se voce receber arquivos visuais ou PDFs junto com o audio, processe-os separadamente.
A transcricao tecnica do audio deve ir no campo 'technicalTranscription'.
A analise dos exames anexados deve ir no campo 'examsAnalysis' (texto limpo e profissional, sem markdown), apenas com o que esta legivel no laudo.
Se nao houver arquivos legiveis, devolva 'examsAnalysis' como null.

CAMPO "termosLiterais" (harness de fidelidade): liste, exatamente como ditos/escritos na fonte, siglas, nomes de metodos, tecnicas, escalas, testes e farmacos citados (ex.: ["CME", "EVA 7"]). Lista vazia se nao houver. Nao inclua termos que voce mesmo acrescentou.

${clinicalTaggingInstruction}`;

    // Verificar se estamos processando apenas exames (sem áudio)
    const isExamsOnly = !audioBase64 && filesToProcess.length > 0;
    
    // Verificar se estamos no modo merge (adicionando a conteudo existente)
    const isMergeMode = !!existingContent;

    const documentMergeFilesHint =
      isMergeMode && filesToProcess.length > 0
        ? `
ANEXOS NO CONTEXTO DE DOCUMENTO CLINICO (RECIBO, PEDIDOS, ATESTADOS, ETC.):
Os ficheiros podem ser capturas de ecra de pagamento (Pix, MB Way, apps bancarias), comprovativos ou recibos. Extraia valor, moeda, data, referencia ou ID da transacao e interlocutores quando legiveis e incorpore no CONTEUDO EXISTENTE como factos em portugues formal, sem apagar informacao correta ja presente.
Se forem exames ou laudos, resuma achados uteis para o documento em elaboracao.
`
        : "";

    // Continuação clínica: uma evolução única. Merge genérico (documentos) preserva o texto.
    const mergeInstruction =
      existingContent && clinicalContinuation
        ? `
⚠️ CONTINUAÇÃO DA ÚLTIMA EVOLUÇÃO CLÍNICA:
O bloco abaixo é a ÚLTIMA evolução já registrada deste paciente. O áudio e/ou anexos desta requisição são informações NOVAS desta consulta.

--- ÚLTIMA EVOLUÇÃO ---
${existingContent}
--- FIM DA ÚLTIMA EVOLUÇÃO ---

REGRAS (obrigatórias):
1. Entregue UMA evolução clínica única e coerente. Não cole um parágrafo novo no final e não repita a evolução anterior na íntegra seguida do áudio.
2. Interprete o que já estava registrado e o que o áudio/anexos acrescentam. Mantenha fatos clínicos ainda válidos que o material novo não contradiz.
3. Não repita queixa, diagnóstico, conduta, achados ou orientações que continuam iguais. Inclua apenas informação nova ou que mudou.
4. Se um dado mudou (dor, amplitude, adesão, medicação, conduta), atualize o trecho correspondente. Não deixe as duas versões lado a lado.
5. Campos queixa, diagnostico, conduta e technicalTranscription devem refletir esse texto integrado — sem valor, preço, Pix ou status de pagamento (isso vai só em commercialCarePlan).
6. professionalActions, patientHandoutBullets/patientHandoutSummary e medicationsAndSupplements: devolva as listas COMPLETAS já integradas. Mantenha Pontos de Ação, Orientações e Medicamentos/Suplementos da última evolução que continuam válidos; atualize o item se dose, prazo ou texto mudou; acrescente só o que é novo. Não duplique a mesma tarefa, orientação ou fármaco. Não devolva apenas o delta. Omita um item anterior só se o material novo disser que foi concluído, suspenso ou substituído.
7. Se o nome do paciente já consta, mantenha-o.
`
        : existingContent
          ? `
⚠️ MODO MERGE INTELIGENTE ATIVADO:
Você está ADICIONANDO informações a um texto JÁ EXISTENTE. O usuário já escreveu/gravou o seguinte conteúdo:

--- CONTEÚDO EXISTENTE ---
${existingContent}
--- FIM DO CONTEÚDO EXISTENTE ---

REGRAS CRÍTICAS DE MERGE:
1. PRESERVE todo o conteúdo existente - NÃO remova nada
2. ADICIONE as novas informações do áudio/exame ao texto existente
3. EVITE redundâncias - se uma informação já existe, não repita
4. RESOLVA conflitos logicamente - se houver dados conflitantes, use a versão mais específica/completa
5. ORGANIZE de forma coerente - integre as informações de forma fluida
6. Se o nome do paciente já estiver no conteúdo existente, MANTENHA esse nome
7. COMBINE os diagnósticos, condutas e observações de ambas as fontes
${documentMergeFilesHint}
`
          : "";

    // Prompt diferente para quando temos apenas exames (sem áudio)
    const promptExamsOnly = `${mergeInstruction}Analise os arquivos de exame/laudo médico anexados e gere uma evolução clínica estruturada baseada nos dados encontrados.

⚠️ MODO: ANÁLISE DE EXAMES SEM ÁUDIO
${filesToProcess.length > 1 ? `${filesToProcess.length} arquivos foram anexados.` : 'Um arquivo foi anexado.'} Você DEVE analisar completamente ${filesToProcess.length > 1 ? 'todos os arquivos' : 'o arquivo'} e extrair todas as informações clínicas relevantes.

TAREFAS:

1. EXTRAIR INFORMAÇÕES ESTRUTURADAS DOS EXAMES:
   - Nome do paciente (se mencionado nos laudos)
   - Idade do paciente (se mencionada)
   - Telefone, nome do pai/mãe/acompanhante se constarem
   - Queixa Principal (somente a indicação clínica escrita no exame; senão null)
   - Diagnóstico (somente conclusões/impressões ESCRITAS no laudo; não deduza diagnóstico a partir dos valores)
   - Conduta (somente recomendações ESCRITAS no laudo; senão null)

2. ANÁLISE COMPLETA DOS EXAMES:
   - Ler e extrair TODOS os dados ${filesToProcess.length > 1 ? 'de todos os arquivos' : 'do arquivo'}
   - Transcrever os resultados principais encontrados
   - Incluir valores de referência quando disponíveis
   - Extrair e destacar as conclusões dos laudos
   - Identificar achados normais e anormais
   - Destacar valores alterados ou fora da normalidade

3. REDIGIR A EVOLUÇÃO TÉCNICA:
   - Descreva em texto corrido os achados que constam nos laudos, com terminologia formal
   - Não acrescente interpretação, hipótese, prognóstico ou conduta que o laudo não traz

FORMATO DE RESPOSTA (CRITICO):
Responda APENAS com um objeto JSON valido neste formato exato (sem markdown, sem negrito **, sem titulos ##, sem crases):
{
  "nome": string ou null (extraido dos exames),
  "idade": string ou null (extraido dos exames),
  ${PATIENT_OPTIONAL_CONTACTS_JSON_FIELDS},
  "dataAtendimento": "DD/MM/AAAA (data mencionada nos exames/relato; se ausente, use ${currentDateBr})",
  "queixa": string ou null (indicacao clinica escrita no exame),
  "diagnostico": string ou null (conclusao escrita no laudo),
  "conduta": string ou null (recomendacoes escritas no laudo),
  "transcricao_corrigida": "texto da evolucao baseada nos exames",
  "technicalTranscription": "texto completo da evolucao baseada nos achados dos exames, em portugues formal e tecnico. SEM markdown. Apenas texto limpo e profissional. Nao repetir bloco de identificacao do paciente (nome/idade/perfil).",
  "examsAnalysis": "resumo detalhado dos achados clinicos dos exames: valores, referencias, conclusoes. SEM markdown, texto limpo e profissional",
  "termosLiterais": [],
  "clinicalMeta": { ... metadados clinicos conforme instrucao do CLINICAL TAGGER acima ... },
  ${EVOLUTION_ARTEFACTOS_JSON_PLACEHOLDERS}
}
${EVOLUTION_ARTEFACTOS_PROMPT_BLOCK}
${PATIENT_OPTIONAL_CONTACTS_PROMPT_RULE}
REGRA DE TEXTO LIMPO:
- NAO use Markdown (negrito **, titulos ##, listas com -, etc.)
- Use texto limpo e profissional
- Se alguma informacao nao estiver presente, use null (nunca "Nao informado")
- Nao invente informacoes que nao estao nos exames
- Nao inclua titulo de documento, secao IDENTIFICACAO nem dados demograficos em technicalTranscription/transcricao_corrigida; nome/idade/queixa/diagnostico/conduta vao nos campos JSON estruturados.
- NUNCA inicie technicalTranscription/transcricao_corrigida com "Paciente, X anos", "EVOLUCAO FISIOTERAPUTICA" ou "IDENTIFICACAO"; comece direto pela HMA/anamnese/evolucao.
- OBRIGATORIO no campo "diagnostico": cada condicao com CID-10 entre parenteses quando houver base no audio.
- OBRIGATORIO: Preencha o campo "clinicalMeta" conforme instrucao do CLINICAL TAGGER`;

    /** Modo documento: só anexos + merge — prompt curto e JSON mínimo (menos falhas e timeout). */
    const promptDocumentFileMergeOnly = `${mergeInstruction}
Leia o(s) anexo(s) (imagem ou PDF). Extraia texto e dados visíveis (valores, datas, nomes, achados de exames, comprovativos de pagamento, etc.).

Responda APENAS com um objeto JSON válido (sem markdown, sem crases). Use null quando não houver dado. Não acrescente informação que não esteja no conteúdo existente ou legível nos anexos.
{
  "nome": "",
  "idade": "",
  ${PATIENT_OPTIONAL_CONTACTS_JSON_FIELDS},
  "dataAtendimento": "DD/MM/AAAA (data do atendimento mencionada nos anexos/conteudo; se ausente, use ${currentDateBr})",
  "queixa": "",
  "diagnostico": "",
  "conduta": "",
  "transcricao_corrigida": "Texto único em português formal que funde o CONTEÚDO EXISTENTE com o que extraiu dos anexos. Preserve o que já estava correto. Sem markdown.",
  "technicalTranscription": "Igual a transcricao_corrigida neste modo.",
  "examsAnalysis": "Resumo objetivo do que foi lido nos anexos.",
  "clinicalMeta": {},
  ${EVOLUTION_ARTEFACTOS_JSON_PLACEHOLDERS}
}
${EVOLUTION_ARTEFACTOS_PROMPT_BLOCK}
${PATIENT_OPTIONAL_CONTACTS_PROMPT_RULE}
Garimpe professionalActions, patientHandout e medicationsAndSupplements a partir do CONTEUDO EXISTENTE e do que extraiu dos anexos (nao invente).`;

    /**
     * `withLiteral`: chamada única com áudio — o modelo transcreve literalmente ANTES de redigir
     * (campo transcricaoLiteral), o que ancora a redação e dá ao servidor a fonte do grounding.
     * No pipeline 2 fases a transcrição já vem da fase 1, então o campo é omitido.
     */
    const buildPromptWithAudio = (withLiteral: boolean) => `${mergeInstruction}Analise o seguinte texto transcrito de uma gravação médica. O texto pode conter erros de fonética, gramaticais e terminologia médica incorreta.
${withLiteral ? `
ORDEM OBRIGATORIA (ancoragem anti-alucinacao):
PASSO 1 — Preencha "transcricaoLiteral" com a fala do audio palavra por palavra, sem corrigir, resumir nem acrescentar. Siglas como pronunciadas. Trecho incompreensivel: [inaudível]. Frase interrompida: pare onde a fala parou.
PASSO 2 — Redija technicalTranscription, queixa, diagnostico, conduta e artefactos USANDO SOMENTE o que esta em "transcricaoLiteral" (e anexos/evolucao anterior, quando houver). Cada frase da narrativa deve corresponder a algo da transcricao literal; se nao corresponder, nao escreva.
` : ""}
${filesToProcess.length > 0 ? `⚠️ ATENÇÃO CRÍTICA: ${filesToProcess.length > 1 ? `${filesToProcess.length} arquivos de exame/laudo foram anexados` : `Um arquivo de exame/laudo (${filesToProcess[0].mimeType}) foi anexado`} junto com o áudio. Você DEVE analisar ${filesToProcess.length > 1 ? 'todos estes arquivos completamente' : 'este arquivo completamente'} e incluir seus achados na resposta final.` : ''}

TAREFAS:

1. EXTRAIR INFORMAÇÕES ESTRUTURADAS:
   - Nome do paciente (se mencionado)
   - Idade do paciente (se mencionada)
   - Telefone do paciente, nome do pai/mãe/acompanhante e telefone de contato, se ditos
   - Queixa Principal (o motivo da consulta ou sintoma principal, como dito; senão null)
   - Diagnóstico (somente diagnóstico, hipótese ou impressão diagnóstica DITA pelo profissional) — com CID-10 entre parênteses em cada condição dita; senão null
   - Conduta (somente tratamento, técnica, prescrição ou orientação DITA; senão null)
   - Analise o texto transcrito, que pode conter erros de fonética
   - Corrija erros gramaticais
   - Corrija termos médicos errados pelo contexto (ex: 'dormir facial' para 'dor miofacial', 'dor lombar' para 'lombalgia')
   - Reescreva o relato em português formal e técnico, adequado para prontuário, com exatamente o conteúdo falado (nada a mais)
   - Mantenha todas as informações clínicas ditas; trecho inaudível ou frase interrompida: omita, não complete
   - Siglas como foram ditas; não expanda sigla cujo significado não foi falado
   - Use terminologia médica correta e formal
   - **NÃO** inclua título do documento, seção IDENTIFICAÇÃO nem dados demográficos (já estão no cabeçalho do formulário)
   - Comece direto pela HMA/anamnese ou evolução clínica

2. ARTEFACTOS (OBRIGATÓRIO quando citados na fala — nao deixe so na conduta/narrativa):
   - Pontos de Ação do PROFISSIONAL → hasProfessionalActions=true + professionalActions[]
   - Orientações ao PACIENTE → hasPatientEducation=true + patientHandoutBullets[] (+ patientHandoutSummary se houver paragrafo)
   - Medicamentos/suplementos nomeados → hasMedicationsAndSupplements=true + medicationsAndSupplements[]
   - Use os gatilhos do bloco ARTEFACTOS abaixo (ex.: "ponto de acao", "eu preciso marcar", "orientacao ao paciente", "cuidados em casa")

${filesToProcess.length > 0 ? `3. ANÁLISE OBRIGATÓRIA DE EXAME COMPLEMENTAR:
   IMPORTANTE: ${filesToProcess.length > 1 ? `${filesToProcess.length} arquivos de exame/laudo foram fornecidos` : 'Um arquivo de exame/laudo foi fornecido'} (PDF ou imagem). Você OBRIGATORIAMENTE deve:
   - Ler e extrair TODOS os dados ${filesToProcess.length > 1 ? 'de todos os arquivos anexos' : 'do arquivo anexo'}
   - Transcrever os resultados principais encontrados ${filesToProcess.length > 1 ? 'em cada arquivo' : 'no arquivo'}
   - Incluir valores de referência quando disponíveis
   - Extrair as conclusões ${filesToProcess.length > 1 ? 'de cada laudo' : 'do laudo'}
   - Correlacionar com o áudio SOMENTE quando o áudio citou uma hipótese E o laudo traz conclusão escrita sobre ela; não crie hipótese para correlacionar
   
   NO TEXTO FINAL (campo "transcricao_corrigida"), você DEVE criar uma seção explícita chamada:
   "ANÁLISE DE EXAMES COMPLEMENTARES"
   
   Nesta seção, inclua:
   - Resumo dos achados principais ${filesToProcess.length > 1 ? 'de cada exame' : 'do exame'}
   - Valores numéricos relevantes (com unidades e valores de referência)
   - Conclusão ${filesToProcess.length > 1 ? 'de cada laudo' : 'do laudo'}
   - Correlação com a hipótese dita no áudio, apenas se o laudo tratar explicitamente dela` : ''}

FORMATO DE RESPOSTA (CRITICO):
Responda APENAS com um objeto JSON valido neste formato exato (sem markdown, sem negrito **, sem titulos ##, sem crases):
{
${withLiteral ? `  "transcricaoLiteral": "fala integral do audio, palavra por palavra (PASSO 1)",\n` : ""}  "nome": string ou null,
  "idade": string ou null,
  ${PATIENT_OPTIONAL_CONTACTS_JSON_FIELDS},
  "dataAtendimento": "DD/MM/AAAA (se houver data mencionada no audio/anexos; senao, use ${currentDateBr})",
  "queixa": string ou null,
  "diagnostico": string ou null — CID-10 entre parenteses apos cada condicao DITA (ex: Ruptura do LCA (S83.5)); null se nenhuma condicao foi dita,
  "conduta": string ou null,
  "transcricao_corrigida": "texto da evolucao tecnica (para compatibilidade - use o mesmo texto de technicalTranscription)",
  "technicalTranscription": "texto completo da evolucao reescrito e corrigido em portugues formal e tecnico, SEM markdown, SEM negrito, SEM titulos com ##. Apenas texto limpo e profissional. CORPO narrativo apenas: sem titulo EVOLUCAO FISIOTERAPUTICA, sem secao IDENTIFICACAO, sem nome/idade/sexo/ocupacao. Comece pela HMA/anamnese. Inclua CID-10 ao mencionar diagnosticos.",
  "examsAnalysis": ${filesToProcess.length > 0 ? '"resumo conciso dos achados clinicos dos exames anexados, valores de referencia e conclusoes escritas nos laudos. SEM markdown, texto limpo e profissional" (null se os arquivos nao forem legiveis)' : 'null (nao ha exames anexados)'},
  "termosLiterais": [],
  "clinicalMeta": { ... metadados clinicos conforme instrucao do CLINICAL TAGGER ... },
  ${EVOLUTION_ARTEFACTOS_JSON_PLACEHOLDERS}
}
${EVOLUTION_ARTEFACTOS_PROMPT_BLOCK}
${PATIENT_OPTIONAL_CONTACTS_PROMPT_RULE}
REGRA DE TEXTO LIMPO:
- NAO use Markdown (negrito **, titulos ##, listas com -, etc.)
- Use texto limpo e profissional
- Se alguma informacao nao estiver presente, use null (nunca "Nao informado")
- Nao invente informacoes que nao estao no audio, nos anexos ou na evolucao anterior
- Nao inclua titulo de documento, secao IDENTIFICACAO nem dados demograficos em technicalTranscription/transcricao_corrigida; nome/idade/queixa/diagnostico/conduta vao nos campos JSON estruturados.
- NUNCA inicie technicalTranscription/transcricao_corrigida com "Paciente, X anos", "EVOLUCAO FISIOTERAPUTICA" ou "IDENTIFICACAO"; comece direto pela HMA/anamnese/evolucao.
- No campo "diagnostico": cada condicao dita com CID-10 entre parenteses; null se nao houver.
${filesToProcess.length > 0 ? `- OBRIGATORIO: Se houver ${filesToProcess.length > 1 ? 'exames anexos' : 'exame anexo'}, preencha o campo "examsAnalysis" com os dados extraidos ${filesToProcess.length > 1 ? 'de todos os arquivos' : 'do arquivo'}. Mantenha "technicalTranscription" apenas com a evolucao do audio.` : ''}
- OBRIGATORIO: Preencha o campo "clinicalMeta" conforme instrucao do CLINICAL TAGGER no System Prompt

Texto a analisar:
Audio fornecido`;

    // Escolher o prompt correto
    const prompt =
      isExamsOnly && isMergeMode && filesToProcess.length > 0
        ? promptDocumentFileMergeOnly
        : isExamsOnly
          ? promptExamsOnly
          : buildPromptWithAudio(true);
    /** Fase 2 recebe a transcrição da fase 1 — sem pedir transcricaoLiteral de novo. */
    const twoPhasePrompt = isExamsOnly ? prompt : buildPromptWithAudio(false);

    // Gemini: parts[] só com objetos Part — nunca push(string) no prompt (400 API).
    const parts: Part[] = [];

    // 1. Prompt de texto (instruções)
    parts.push({ text: prompt });
    
    // 2. Arquivos convertidos (se houver)
    if (filesToProcess.length > 0) {
      const imageCount = filesToProcess.filter(f => f.mimeType.startsWith('image/')).length;
      const pdfCount = filesToProcess.filter(f => f.mimeType === 'application/pdf').length;
      console.log(`📤 [DEBUG] Enviando ${filesToProcess.length} arquivo(s) para o Gemini (${imageCount} imagem(ns), ${pdfCount} PDF(s))`);
      
      for (const file of filesToProcess) {
        const rawMime = (file.mimeType || "image/jpeg").toLowerCase().split(";")[0].trim();
        const mimeForApi = rawMime === "image/jpg" ? "image/jpeg" : rawMime || "image/jpeg";
        const filePart = {
          inlineData: {
            data: file.base64,
            mimeType: mimeForApi,
          },
        };
        parts.push(filePart);
        console.log(`  ✓ Adicionado ao payload: ${mimeForApi} (${file.base64.length} chars)`);
      }
    } else {
      console.log("📤 [DEBUG] Nenhum arquivo para enviar ao Gemini");
    }
    
    // 3. Objeto do Áudio (somente se houver áudio)
    let evolutionAudioPart: Part | null = null;
    if (audioBase64) {
      const rawMime = (audioMimeType || "audio/webm").split(";")[0]!.trim().toLowerCase();
      const mimeForAudio =
        rawMime === "audio/x-m4a" ? "audio/mp4" : rawMime === "audio/m4a" ? "audio/mp4" : rawMime;
      evolutionAudioPart = {
        inlineData: {
          data: audioBase64,
          mimeType: mimeForAudio || "audio/webm",
        },
      };
      parts.push(evolutionAudioPart);
      console.log(`📤 [DEBUG] Payload final: ${parts.length} part(s) (1 prompt + ${filesToProcess.length} arquivo(s) + 1 áudio)`);
    } else {
      console.log(`📤 [DEBUG] Payload final (SOMENTE EXAMES): ${parts.length} part(s) (1 prompt + ${filesToProcess.length} arquivo(s), SEM áudio)`);
    }

    // Evita timeout artificial em áudios mais longos (relato recorrente ~3 min).
    // Mantemos teto abaixo do maxDuration da rota para não estourar o serverless.
    const approxAudioBytes = approxBytesFromBase64(audioBase64);
    const multimodalTimeoutMs = audioBase64
      ? evolutionMultimodalTimeoutMs(approxAudioBytes)
      : 180_000;
    const useJsonMime = process.env.GEMINI_EVOLUTION_JSON_MIME === "1";

    const preferFastModelForLongAudio =
      !!audioBase64 && approxAudioBytes >= 6 * 1024 * 1024;
    const visionModelOrder = audioBase64
      ? getAudioMultimodalModelIds()
      : isExamsOnly && isMergeMode && filesToProcess.length > 0
        ? getDocumentMergeVisionModelIds()
        : preferFastModelForLongAudio
          ? getDocumentMergeVisionModelIds()
          : undefined;

    const examFileParts: Part[] = filesToProcess.map((file) => {
      const rawMime = (file.mimeType || "image/jpeg").toLowerCase().split(";")[0].trim();
      const mimeForApi = rawMime === "image/jpg" ? "image/jpeg" : rawMime || "image/jpeg";
      return {
        inlineData: { data: file.base64, mimeType: mimeForApi },
      };
    });

    const preferTwoPhasePipeline =
      !!evolutionAudioPart &&
      isLongEvolutionAudio({ approxAudioBytes, audioDurationSec });

    if (audioBase64) {
      console.log(
        `[generateEvolution] audioBytes≈${approxAudioBytes} durationSec=${audioDurationSec ?? "?"} timeoutMs=${multimodalTimeoutMs} twoPhase=${preferTwoPhasePipeline}`,
      );
    }

    let responseText: string;
    /** Transcrição literal (2 fases): fonte completa para o harness de grounding. */
    let groundingTranscript: string | null = null;
    if (preferTwoPhasePipeline && evolutionAudioPart) {
      console.log("[generateEvolution] Áudio longo — pipeline 2 fases (transcrever → estruturar)");
      const twoPhase = await generateEvolutionResponseViaTwoPhase({
        systemInstruction,
        prompt: twoPhasePrompt,
        audioPart: evolutionAudioPart,
        examFileParts,
        multimodalTimeoutMs,
      });
      responseText = twoPhase.text;
      groundingTranscript = twoPhase.transcript;
    } else {
      try {
        const { result, modelUsed } = await generateContentSafeWithModelFallback(
          {
            systemInstruction,
            generationConfig: clinicalGenerationConfig({
              // Áudio curto: transcrição literal (~1k tokens) + JSON; folga para modelos com thinking.
              maxOutputTokens: evolutionAudioPart ? 12_288 : 8192,
              ...(useJsonMime ? { responseMimeType: "application/json" as const } : {}),
            }),
          },
          parts,
          multimodalTimeoutMs,
          visionModelOrder,
        );
        console.log(`[generateEvolution] Multimodal OK com modelo: ${modelUsed}`);
        responseText = result.response.text();
      } catch (multimodalErr) {
        if (evolutionAudioPart && shouldTryEvolutionTwoPhaseFallback(multimodalErr)) {
          console.warn(
            "[generateEvolution] Multimodal falhou; tentativa em 2 fases…",
            multimodalErr instanceof Error ? multimodalErr.message : multimodalErr,
          );
          const twoPhase = await generateEvolutionResponseViaTwoPhase({
            systemInstruction,
            prompt: twoPhasePrompt,
            audioPart: evolutionAudioPart,
            examFileParts,
            multimodalTimeoutMs,
          });
          responseText = twoPhase.text;
          groundingTranscript = twoPhase.transcript;
          console.log("[generateEvolution] Sucesso via fallback 2 fases");
        } else {
          throw multimodalErr;
        }
      }
    }
    const parseEvolutionJson = (
      text: string,
    ): { json: Record<string, unknown> } | { error: "no-json" | "invalid-json" } => {
      const cleaned = text
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .replace(/^\s*```\s*\n?/gm, "")
        .trim();
      const slice =
        extractFirstJsonObject(cleaned) ?? cleaned.match(/\{[\s\S]*\}/)?.[0] ?? null;
      if (!slice) {
        console.error("[generateEvolution] Resposta sem objeto JSON:", cleaned.slice(0, 600));
        return { error: "no-json" };
      }
      try {
        return { json: JSON.parse(slice) as Record<string, unknown> };
      } catch (parseErr) {
        console.error("[generateEvolution] JSON.parse falhou:", parseErr, slice.slice(0, 800));
        return { error: "invalid-json" };
      }
    };

    let parsedEvolution = parseEvolutionJson(responseText);
    // Chamada única com transcrição literal: se o JSON vier truncado/inválido, 2 fases uma vez.
    if ("error" in parsedEvolution && evolutionAudioPart && groundingTranscript === null) {
      console.warn("[generateEvolution] JSON inválido na chamada única — retry via 2 fases");
      const twoPhase = await generateEvolutionResponseViaTwoPhase({
        systemInstruction,
        prompt: twoPhasePrompt,
        audioPart: evolutionAudioPart,
        examFileParts,
        multimodalTimeoutMs,
      });
      groundingTranscript = twoPhase.transcript;
      parsedEvolution = parseEvolutionJson(twoPhase.text);
    }
    if ("error" in parsedEvolution) {
      throw new Error(
        parsedEvolution.error === "no-json"
          ? "A IA não devolveu um formato reconhecível. Tente novamente ou use outro ficheiro."
          : "A IA devolveu uma resposta inválida. Tente de novo ou use um PDF/imagem mais pequeno.",
      );
    }
    let rawJson = parsedEvolution.json;

    /** Transcrição literal da chamada única (passo 1 do prompt) vira fonte do grounding completo. */
    const MIN_LITERAL_TRANSCRIPT_CHARS = 40;
    const literalFrom = (json: Record<string, unknown>): string | null => {
      const literal = normalizeNotInformed(json.transcricaoLiteral);
      return literal.length >= MIN_LITERAL_TRANSCRIPT_CHARS ? literal : null;
    };
    if (groundingTranscript === null && evolutionAudioPart) {
      groundingTranscript = literalFrom(rawJson);
      console.log(
        `[generateEvolution] grounding: ${groundingTranscript ? "transcrição literal (full)" : "termosLiterais (collapse-only)"}`,
      );
    }

    const groundingFor = (json: Record<string, unknown>, transcript: string | null) =>
      applyClinicalGroundingHarness(
        json,
        [transcript, existingContent].filter(Boolean).join("\n"),
        transcript ? "full" : "collapse-only",
      );
    let { data, groundingWarnings } = groundingFor(rawJson, groundingTranscript);
    
    // Garantir compatibilidade transcricao_corrigida / technicalTranscription
    if (data.technicalTranscription && !data.transcricao_corrigida) {
      data.transcricao_corrigida = data.technicalTranscription;
    } else if (!data.technicalTranscription && data.transcricao_corrigida) {
      data.technicalTranscription = data.transcricao_corrigida;
    }

    data = attachOptionalContacts(postProcessEvolutionTranscriptionFields(data));

    // Áudio longo: se a IA devolveu JSON sem transcrição útil, tentar pipeline 2 fases uma vez.
    if (
      audioBase64 &&
      evolutionAudioPart &&
      !hasUsableEvolutionTranscription(data) &&
      !preferTwoPhasePipeline
    ) {
      console.warn(
        "[generateEvolution] Resposta sem transcrição útil — retry via pipeline 2 fases",
      );
      const retry = await generateEvolutionResponseViaTwoPhase({
        systemInstruction,
        prompt: twoPhasePrompt,
        audioPart: evolutionAudioPart,
        examFileParts,
        multimodalTimeoutMs,
      });
      const retryCleaned = retry.text
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .replace(/^\s*```\s*\n?/gm, "")
        .trim();
      const retrySlice =
        extractFirstJsonObject(retryCleaned) ?? retryCleaned.match(/\{[\s\S]*\}/)?.[0] ?? null;
      if (retrySlice) {
        try {
          const retryJson = JSON.parse(retrySlice) as Record<string, unknown>;
          const retryGrounded = groundingFor(retryJson, retry.transcript);
          if (hasUsableEvolutionTranscription(retryGrounded.data)) {
            rawJson = retryJson;
            groundingWarnings = retryGrounded.groundingWarnings;
            data = attachOptionalContacts(postProcessEvolutionTranscriptionFields(retryGrounded.data));
          }
        } catch {
          /* mantém data original */
        }
      }
    }

    if (audioBase64 && !hasUsableEvolutionTranscription(data)) {
      throw new Error(
        "A transcrição do áudio não foi gerada. Tente gravar novamente ou divida a consulta em partes menores.",
      );
    }
    
    // Garantir que examsAnalysis exista (mesmo que vazio)
    if (!data.examsAnalysis) {
      data.examsAnalysis = '';
    }

    const { professionalActions, patientHandout, medicationsAndSupplements, commercialCarePlan } =
      parseAndSanitizeEvolutionArtifacts(rawJson);
    const filteredActions = stripCommercialRegistrationActions(
      professionalActions,
      commercialCarePlan,
    );

    // NOTA: Pacientes NÃO são mais criados aqui. A criação/vinculação acontece apenas
    // no saveEvolution (patient.ts), quando o PDF é gerado. Isso evita "pacientes fantasma":
    // ao vincular uma evolução a um paciente existente (aviso de nome similar), não deve
    // existir outro paciente criado prematuramente com nome parecido (ex: Lourenço).
    let patientMessage = "";
    if (data.nome) {
      patientMessage = `Paciente "${data.nome}" identificado no áudio.`;
    } else {
      patientMessage = "Paciente não identificado no áudio.";
    }

    return {
      ...data,
      ...(groundingWarnings.length ? { groundingWarnings } : {}),
      professionalActions: filteredActions,
      patientHandout,
      medicationsAndSupplements,
      commercialCarePlan,
      patientMessage,
    };
  } catch (error) {
    console.error("Erro na IA ou Banco:", error);
    return {
      error: formatAiProviderErrorForUser(error),
    };
  }
}

// Extrai métricas clínicas estruturadas ("Evolução Visual") a partir das evoluções de um paciente
export async function extractVisualMetricsForPatient(
  patientId: string
): Promise<VisualMetric[]> {
  try {
    const dbUserId = await getAuthenticatedDbUserId();
    if (!dbUserId) {
      return [];
    }

    const hdrs = await headers();
    const rl = await enforceAiBillingRateLimit({
      userKey: dbUserId,
      ip: getRequestClientIp(hdrs),
    });
    if (!rl.allowed) {
      return [];
    }

    const patient = await prisma.patient.findFirst({
      where: { id: patientId, userId: dbUserId },
      include: {
        evolutions: {
          orderBy: { date: "asc" },
          take: 20, // evoluções para contexto
        },
      },
    });

    if (!patient || patient.evolutions.length === 0) {
      return [];
    }

    const model = getGeminiModel({
      systemInstruction: `Você é um assistente clínico especializado em transformar evoluções em MÉTRICAS QUANTITATIVAS.

TAREFA: Ler a sequência de evoluções de um mesmo paciente e gerar MÉTRICAS NUMÉRICAS que representem a evolução ao longo do tempo, usando a ESCALA QUE FIZER SENTIDO para cada medida (não force tudo para 0–10).

EXEMPLOS DE NOME DE MÉTRICAS:
- "EVA (0–10)" ou "Dor (EVA)"
- "Pontuação/questionário (total)"
- "Mobilidade", "Força", "1RM estimado (kg)"
- "Função Global", "Qualidade do Sono", "Adesão ao Tratamento"

REGRAS:
1. O campo "value" deve ser um número coerente com o nome da métrica e o texto da evolução (pode ser > 10, ex.: totais de questionário, cargas, repetições).
2. Se usar EVA ou escala 0–10, mantenha o valor dentro desse intervalo apenas para essa métrica.
3. A data da métrica deve ser coerente com a evolução de origem.
4. Não invente datas futuras.
5. Use no máximo 5 tipos diferentes de métricas por paciente para manter o gráfico legível.
6. Só gere uma métrica quando o NÚMERO estiver escrito na evolução (ex.: "EVA 7", "flexão 90°", "3x10 com 5 kg"). Não estime nem converta impressões qualitativas em nota.
7. Sem números explícitos nas evoluções: devolva {"metrics": []}.

FORMATO EXATO DE RESPOSTA (JSON PURO):
{
  "metrics": [
    {
      "name": "Exemplo de métrica",
      "value": 3.5,
      "date": "2026-03-18",
      "sourceEvolutionId": "evolution-id-1"
    }
  ]
}

NÃO use markdown, não use comentários, não adicione texto fora do JSON.`,
      generationConfig: clinicalGenerationConfig(),
    });

    const evolutionsSummary = patient.evolutions
      .map((ev) => {
        const dateIso = ev.date.toISOString().split("T")[0];
        const content = (ev.content || "").slice(0, 1200);
        return `- ID: ${ev.id}\n  Data: ${dateIso}\n  Texto: ${content}`;
      })
      .join("\n\n");

    const prompt = `Paciente: ${patient.name}
Diagnóstico principal (se houver): ${patient.diagnosis || "não informado"}

Evoluções (da mais antiga para a mais recente):

${evolutionsSummary}

Gerar as métricas conforme o formato JSON especificado.`;

    const result = await generateContentSafe(model, prompt, 60_000, 1);
    let text = result.response.text().trim();

    text = text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      text = jsonMatch[0];
    }

    const parsed = JSON.parse(text) as { metrics?: VisualMetric[] };
    if (!parsed.metrics || !Array.isArray(parsed.metrics)) {
      return [];
    }

    return parsed.metrics
      .filter(
        (m) =>
          typeof m.name === "string" &&
          typeof m.value === "number" &&
          Number.isFinite(m.value) &&
          typeof m.date === "string"
      )
      .map((m) => {
        const v = Math.max(-1e7, Math.min(1e7, m.value));
        return {
          name: m.name.trim(),
          value: v,
          date: m.date.split("T")[0],
          sourceEvolutionId: m.sourceEvolutionId,
        };
      });
  } catch (error) {
    console.error("[extractVisualMetricsForPatient] Erro:", error);
    return [];
  }
}

