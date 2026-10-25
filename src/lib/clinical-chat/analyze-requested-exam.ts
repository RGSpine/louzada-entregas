/**
 * Detecção e análise multimodal de exame — só quando o profissional pede explicitamente.
 */
import { z } from "zod";
import type { Part } from "@google/generative-ai";
import { prisma } from "@/lib/prisma";
import { getGeminiFastModel, generateContentSafe, generateContentSafeWithModelFallback, getMultimodalModelCandidateIds } from "@/lib/gemini";
import { sanitizeText } from "@/lib/sanitize";
import {
  getPatientExamForAnalysis,
  type PatientExamCatalogEntry,
} from "@/lib/clinical-chat/exam-catalog";

const ALLOWED_EXAM_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const MAX_EXAM_BYTES = 8 * 1024 * 1024;

const detectSchema = z.object({
  wantsExamAnalysis: z.boolean(),
  examId: z.string().uuid().nullable().optional(),
  rationale: z.string().max(300).optional(),
});

export type DetectRequestedExamResult = {
  wantsExamAnalysis: boolean;
  examId: string | null;
};

export type OnDemandExamAnalysisBlock = {
  examId: string;
  title: string;
  dateLabel: string;
  analysisText: string;
  fromLiveFile: boolean;
};

function stripJsonFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function formatCatalogForClassifier(catalog: PatientExamCatalogEntry[]): string {
  if (catalog.length === 0) {
    return "(Nenhum exame/documento na pasta deste paciente.)";
  }
  return catalog
    .map((e, i) => {
      const date = e.createdAt.toLocaleDateString("pt-BR");
      const summaryFlag = e.hasAiSummary ? "com resumo IA" : "sem resumo IA";
      return `${i + 1}. id=${e.id} | ${e.title} (${date}) — ${summaryFlag}`;
    })
    .join("\n");
}

/**
 * Gemini Flash: detecta pedido EXPLÍCITO de análise de um exame anexado.
 */
export async function detectRequestedExamAnalysis(
  userQuestion: string,
  catalog: PatientExamCatalogEntry[],
): Promise<DetectRequestedExamResult> {
  if (catalog.length === 0) {
    return { wantsExamAnalysis: false, examId: null };
  }

  const systemInstruction = `Você classifica se o profissional pede análise de um exame/documento ANEXADO na pasta do paciente.

wantsExamAnalysis=true SOMENTE quando há pedido EXPLÍCITO para analisar, ler, interpretar, extrair ou revisar um arquivo de exame/laudo/documento da pasta (ex.: "analise o hemograma anexado", "leia o laudo do paciente", "interprete o exame de imagem", "o que mostra o PDF do exame").

wantsExamAnalysis=false para:
- perguntas sobre evoluções, resumo clínico ou métricas já no prontuário;
- "o que diz a evidência" / literatura externa;
- mencionar exame sem pedir leitura do arquivo (ex.: "ele fez hemograma?" sem pedir análise);
- listar ou contar exames.

examId: UUID exato da lista quando identificar qual arquivo; se disser "último exame" use o item 1; null se wantsExamAnalysis=true mas ambíguo.

Responda APENAS JSON: {"wantsExamAnalysis":boolean,"examId":string|null,"rationale":string}`;

  const userBlock = `Exames na pasta do paciente:
${formatCatalogForClassifier(catalog)}

Pergunta do profissional:
${sanitizeText(userQuestion)}`;

  const model = getGeminiFastModel({
    systemInstruction,
    generationConfig: { temperature: 0 },
  });
  const result = await generateContentSafe(model, userBlock, 45_000, 1);
  const raw = result.response.text();

  let json: unknown;
  try {
    json = JSON.parse(stripJsonFences(typeof raw === "string" ? raw : ""));
  } catch {
    return { wantsExamAnalysis: false, examId: null };
  }

  const parsed = detectSchema.safeParse(json);
  if (!parsed.success || !parsed.data.wantsExamAnalysis) {
    return { wantsExamAnalysis: false, examId: null };
  }

  const examId = parsed.data.examId ?? null;
  if (examId && catalog.some((e) => e.id === examId)) {
    return { wantsExamAnalysis: true, examId };
  }

  return { wantsExamAnalysis: true, examId: null };
}

async function fetchExamInlinePart(
  exam: PatientExamCatalogEntry,
): Promise<Part | null> {
  try {
    const res = await fetch(exam.fileUrl, { cache: "no-store" });
    if (!res.ok) return null;
    const mime =
      res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ||
      exam.fileType?.split(";")[0]?.trim().toLowerCase() ||
      "application/octet-stream";
    if (!ALLOWED_EXAM_MIME.has(mime)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_EXAM_BYTES) return null;
    return { inlineData: { mimeType: mime, data: buf.toString("base64") } };
  } catch {
    return null;
  }
}

const CLINICAL_EXAM_ANALYSIS_SYSTEM = `
Você analisa exames clínicos (imagem ou PDF de laudo) para apoio à decisão profissional.
Extraia de forma estruturada e objetiva:
- Identificação do exame (se visível);
- Valores/achados principais com unidades e referências quando legíveis;
- Conclusões ou impressões do laudo;
- Alterações relevantes.

Regras:
- Não invente dados que não estejam no documento.
- Se ilegível ou parcial, indique o que não foi possível ler.
- Português brasileiro, texto claro (pode usar listas e negrito leve).
- Não prescreva tratamento.
`.trim();

/**
 * Lê o arquivo do exame com Gemini multimodal e devolve análise clínica textual.
 */
async function analyzeExamFileContent(
  exam: PatientExamCatalogEntry,
  userQuestion: string,
  inlinePart: Part,
): Promise<string> {
  const parts: Part[] = [
    {
      text: `Exame: ${exam.title} (${exam.createdAt.toLocaleDateString("pt-BR")}).\nPergunta do profissional: ${sanitizeText(userQuestion)}\n\nAnalise o documento anexo:`,
    },
    inlinePart,
  ];

  const { result } = await generateContentSafeWithModelFallback(
    {
      systemInstruction: CLINICAL_EXAM_ANALYSIS_SYSTEM,
      generationConfig: { temperature: 0.1 },
    },
    parts,
    120_000,
    getMultimodalModelCandidateIds(),
  );

  const text = result.response.text();
  return typeof text === "string" ? sanitizeText(text.trim()) : "";
}

export type RunOnDemandExamAnalysisResult =
  | { ok: true; block: OnDemandExamAnalysisBlock }
  | { ok: false; userMessage: string };

/**
 * Executa análise sob demanda quando o pedido foi explícito e o exame foi identificado.
 */
export async function runOnDemandExamAnalysis(
  examId: string,
  patientId: string,
  userId: string,
  userQuestion: string,
): Promise<RunOnDemandExamAnalysisResult> {
  const exam = await getPatientExamForAnalysis(examId, patientId, userId);
  if (!exam) {
    return {
      ok: false,
      userMessage: "Exame não encontrado ou sem permissão de acesso.",
    };
  }

  const dateLabel = exam.createdAt.toLocaleDateString("pt-BR");
  const inlinePart = await fetchExamInlinePart(exam);

  if (!inlinePart) {
    return {
      ok: false,
      userMessage:
        "Não foi possível ler o arquivo do exame (formato não suportado, arquivo indisponível ou acima de 8 MB).",
    };
  }

  let analysisText: string;
  try {
    analysisText = await analyzeExamFileContent(exam, userQuestion, inlinePart);
  } catch {
    return {
      ok: false,
      userMessage: "Falha ao analisar o exame com a IA. Tente novamente em instantes.",
    };
  }

  if (!analysisText) {
    return {
      ok: false,
      userMessage: "A análise do exame não retornou conteúdo. O arquivo pode estar ilegível.",
    };
  }

  try {
    await prisma.patientExam.update({
      where: { id: exam.id },
      data: { aiSummary: analysisText.slice(0, 12_000) },
    });
  } catch {
    /* persistência best-effort — a resposta do chat segue */
  }

  return {
    ok: true,
    block: {
      examId: exam.id,
      title: exam.title,
      dateLabel,
      analysisText,
      fromLiveFile: true,
    },
  };
}
