import { z } from "zod";
import { getGeminiFastModel, generateContentSafe } from "@/lib/gemini";
import { sanitizeText } from "@/lib/sanitize";

const analyzeOutputSchema = z.object({
  needsLiterature: z.boolean(),
  searchQueries: z.array(z.string().min(8).max(200)).max(2),
  rationale: z.string().max(400).optional(),
});

export type AnalyzePatientHealthQuestionResult = z.infer<
  typeof analyzeOutputSchema
>;

function stripJsonFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

/**
 * Decide se a pergunta do paciente precisa de evidência externa (PubMed/Perplexity).
 * Queries sempre anonimizadas, em inglês acadêmico.
 */
export async function analyzePatientHealthQuestion(
  anonymizedCaseHint: string,
  userQuestion: string,
): Promise<AnalyzePatientHealthQuestionResult> {
  const systemInstruction = `Você classifica perguntas de um PACIENTE leigo para busca de evidência científica (PubMed/Perplexity).
A evidência embasa o raciocínio do assistente; as referências não são mostradas ao paciente, salvo se ele pedir fontes.
Regras:
1. needsLiterature=true quando a pergunta pede opinião, avaliação de risco, se algo é normal/perigoso, se há falha ou inconsistência no cuidado, eficácia, segurança, comparação de condutas, ou quando o contexto sugere um problema clínico a esclarecer.
2. needsLiterature=false só para: listar agenda, tarefas ou o que já foi dito, sem julgar se está certo; FAQ do app; marcar horário na vitrine.
3. Se needsLiterature=true, searchQueries é obrigatório (1 ou 2).
4. searchQueries: em INGLÊS acadêmico, SEM nomes próprios, CPF, telefone, endereço, datas de atendimento ou qualquer dado identificável.
5. Máximo 2 queries curtas e específicas.
6. Responda APENAS JSON válido: {"needsLiterature":boolean,"searchQueries":string[],"rationale":string}`;

  const userBlock = `Contexto anonimizado do mapa de saúde:
${anonymizedCaseHint}

Pergunta do paciente:
${sanitizeText(userQuestion)}`;

  const model = getGeminiFastModel({
    systemInstruction,
    generationConfig: { temperature: 0.1 },
  });
  const result = await generateContentSafe(model, userBlock, 45_000, 1);
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
    .map((q) =>
      sanitizeText(q).replace(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, "[paciente]"),
    )
    .filter((q) => q.length >= 8)
    .slice(0, 2);

  return {
    needsLiterature: parsed.data.needsLiterature && queries.length > 0,
    searchQueries: queries,
    rationale: parsed.data.rationale,
  };
}
