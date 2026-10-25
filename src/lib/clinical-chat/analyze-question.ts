import { z } from "zod";
import {
  getGeminiFastModel,
  generateContentSafe,
  GEMINI_FAST_MODEL,
} from "@/lib/gemini";
import { sanitizeText } from "@/lib/sanitize";
import type { PatientChatContext } from "@/lib/clinical-chat/build-patient-context";
import { logGeminiUsage } from "@/lib/ai-usage";

const analyzeOutputSchema = z.object({
  needsLiterature: z.boolean(),
  searchQueries: z.array(z.string().min(8).max(200)).max(2),
  rationale: z.string().max(400).optional(),
});

export type AnalyzeClinicalQuestionResult = z.infer<typeof analyzeOutputSchema>;

function stripJsonFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function buildAnonymizedCaseHint(context: PatientChatContext): string {
  const diag = context.diagnosis?.trim();
  const age = context.age?.trim() || "não informada";
  const topics =
    context.highlightsBullets.length > 0
      ? context.highlightsBullets.slice(0, 6).join("; ")
      : "";
  const summary = context.clinicalSummary?.trim()
    ? context.clinicalSummary.slice(0, 600)
    : "";
  const examHint =
    context.examCount > 0
      ? `Exames na pasta: ${context.examCount} arquivo(s) com resumos IA quando processados.`
      : "";
  const medicationHint =
    context.medicationsBlock &&
    !context.medicationsBlock.startsWith("(Sem medicamentos")
      ? "Há medicamentos/suplementos estruturados nas evoluções recentes."
      : "";
  return [
    `Idade: ${age}`,
    diag ? `Diagnóstico registrado: ${diag}` : null,
    topics ? `Tópicos do caso: ${topics}` : null,
    summary ? `Resumo clínico (sem identificadores): ${summary}` : null,
    examHint || null,
    medicationHint || null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Fase 1: decide se precisa literatura e gera queries anonimizadas (sem nome do paciente).
 */
export async function analyzeClinicalQuestion(
  context: PatientChatContext,
  userQuestion: string,
): Promise<AnalyzeClinicalQuestionResult> {
  const systemInstruction = `Você classifica perguntas clínicas para busca de evidência científica.
Regras:
1. needsLiterature=true quando a pergunta pede eficácia, segurança, diretrizes, comparação de condutas, prognóstico baseado em literatura, ou "o que diz a evidência".
2. needsLiterature=false para: resumir evoluções, listar condutas já registradas, valores de exames, métricas, medicamentos ou suplementos já no prontuário, pedido explícito de analisar/ler um arquivo da pasta de exames, perguntas de agenda ou financeiro do paciente (essas usam blocos sob demanda por termos, não literatura), esclarecer dados só do contexto interno, perguntas administrativas.
3. searchQueries: em INGLÊS acadêmico, SEM nomes próprios, CPF, telefone, endereço, datas específicas de atendimento ou qualquer dado identificável.
4. Máximo 2 queries curtas e específicas.
5. Responda APENAS JSON válido: {"needsLiterature":boolean,"searchQueries":string[],"rationale":string}`;

  const userBlock = `Contexto anonimizado do caso:
${buildAnonymizedCaseHint(context)}

Pergunta do profissional:
${sanitizeText(userQuestion)}`;

  const model = getGeminiFastModel({
    systemInstruction,
    generationConfig: { temperature: 0.1 },
  });
  const result = await generateContentSafe(model, userBlock, 45_000, 1);
  logGeminiUsage(result, {
    service: "ester_analyze",
    model: GEMINI_FAST_MODEL,
    surface: "pro",
  });
  const raw = result.response.text();
  let json: unknown;
  try {
    json = JSON.parse(stripJsonFences(typeof raw === "string" ? raw : ""));
  } catch {
    return { needsLiterature: false, searchQueries: [] };
  }

  const parsed = analyzeOutputSchema.safeParse(json);
  if (!parsed.success) {
    return { needsLiterature: false, searchQueries: [] };
  }

  const queries = parsed.data.searchQueries
    .map((q) => sanitizeText(q).replace(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, "[paciente]"))
    .filter((q) => q.length >= 8)
    .slice(0, 2);

  return {
    needsLiterature: parsed.data.needsLiterature && queries.length > 0,
    searchQueries: queries,
    rationale: parsed.data.rationale,
  };
}
