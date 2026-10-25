import { prisma } from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import { getPatientAccessScope } from "@/lib/intra-user/patient-access";
import { scopedPatientWhereOrEmpty } from "@/lib/intra-user/patient-scope";
import { parseClinicalCaseHighlightsStored } from "@/lib/clinical-case-highlights";
import { formatEvidenceBlockForPrompt } from "@/lib/clinical-chat/citations";
import type { ClinicalChatCitation } from "@/lib/clinical-chat/citations";
import type { OnDemandExamAnalysisBlock } from "@/lib/clinical-chat/analyze-requested-exam";
import {
  ESTER_AGENT_NAME,
  ESTER_SYSTEM_IDENTITY,
} from "@/lib/clinical-chat/ester-branding";
import {
  CHAT_HISTORY_MESSAGES,
  CHAT_MAX_CHARS_PER_EXAM,
  CHAT_MAX_CHARS_PER_ROW,
  CHAT_MAX_EVOLUTION_ROWS,
  CHAT_MAX_EXAM_ROWS,
  CHAT_MAX_METRIC_ROWS,
  CHAT_TOTAL_BUDGET,
} from "@/lib/clinical-chat/constants";
import {
  formatCareTimelineBlock,
  loadSharedCareTimelineForChart,
} from "@/lib/b2c/care-timeline";
import {
  coerceMedicationsAndSupplementsForReview,
  formatMedicationsAndSupplementsForDocument,
  medicationsAndSupplementsHasContent,
} from "@/lib/evolution-artifacts";

export {
  CHAT_HISTORY_MESSAGES,
  CHAT_MAX_EVOLUTION_ROWS,
  CHAT_MAX_CHARS_PER_ROW,
  CHAT_TOTAL_BUDGET,
} from "@/lib/clinical-chat/constants";

export type PatientChatContext = {
  patientId: string;
  name: string;
  age: string | null;
  diagnosis: string | null;
  clinicalSummary: string | null;
  highlightsBullets: string[];
  evolutionCount: number;
  examCount: number;
  evolutionBlock: string;
  examsBlock: string;
  medicationsBlock: string;
  metricsBlock: string;
  journalBlock: string;
};

export type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

function appendBudgetedBlock(
  chunks: string[],
  budget: { remaining: number },
  header: string,
  body: string,
  minRoom = 80,
): void {
  if (budget.remaining < minRoom + header.length) return;
  const room = budget.remaining - header.length;
  const bodySlice = body.length <= room ? body : body.slice(0, room);
  chunks.push(header + bodySlice);
  budget.remaining -= header.length + bodySlice.length;
}

export async function buildPatientContextForChat(
  patientId: string,
  userId: string,
): Promise<PatientChatContext | null> {
  // Segregação por Intra User (owner/compartilhado ou ADMIN); sem perfil → fail-closed.
  const scope = await getPatientAccessScope();
  const scopeWhere = scopedPatientWhereOrEmpty(userId, scope);
  const patient = await prisma.patient.findFirst({
    where: { ...scopeWhere, id: patientId },
    select: {
      id: true,
      name: true,
      age: true,
      diagnosis: true,
      clinicalSummary: true,
      clinicalCaseHighlights: true,
      _count: { select: { evolutions: true, exams: true } },
    },
  });
  if (!patient) return null;

  const [evRows, examRows, metricRows] = await Promise.all([
    prisma.evolution.findMany({
      where: { patientId, patient: { userId } },
      orderBy: { date: "desc" },
      take: CHAT_MAX_EVOLUTION_ROWS,
      select: { content: true, date: true, tags: true, medicationsAndSupplements: true },
    }),
    prisma.patientExam.findMany({
      where: { patientId, patient: { userId } },
      orderBy: { createdAt: "desc" },
      take: CHAT_MAX_EXAM_ROWS,
      select: {
        title: true,
        aiSummary: true,
        source: true,
        documentType: true,
        createdAt: true,
      },
    }),
    prisma.patientMetric.findMany({
      where: { patientId, patient: { userId } },
      orderBy: { date: "desc" },
      take: CHAT_MAX_METRIC_ROWS,
      select: { name: true, value: true, unit: true, date: true, reasoning: true },
    }),
  ]);

  const budget = { remaining: CHAT_TOTAL_BUDGET };
  const evolutionChunks: string[] = [];
  for (const ev of evRows) {
    const rawEvo = (ev.content || "").trim();
    if (!rawEvo) continue;
    const cleaned = sanitizeText(rawEvo).slice(0, CHAT_MAX_CHARS_PER_ROW);
    if (!cleaned) continue;
    const dateStr = ev.date.toLocaleDateString("pt-BR");
    const tagStr =
      ev.tags && ev.tags.length > 0 ? ` Tags: ${ev.tags.slice(0, 8).join(", ")}.` : "";
    appendBudgetedBlock(
      evolutionChunks,
      budget,
      `--- Evolução ${dateStr}.${tagStr} ---\n`,
      cleaned,
    );
    if (budget.remaining < 80) break;
  }

  const examChunks: string[] = [];
  for (const exam of examRows) {
    const dateStr = exam.createdAt.toLocaleDateString("pt-BR");
    const label =
      exam.title?.trim() ||
      (exam.source === "AI_GENERATED" && exam.documentType
        ? `Documento ${exam.documentType}`
        : "Exame/documento");
    const summary = exam.aiSummary?.trim()
      ? sanitizeText(exam.aiSummary).slice(0, CHAT_MAX_CHARS_PER_EXAM)
      : "(Arquivo na pasta sem resumo IA — peça «analise o exame X» no chat ou use a aba Exames.)";
    appendBudgetedBlock(
      examChunks,
      budget,
      `--- Pasta Exames: ${label} (${dateStr}) ---\n`,
      summary,
    );
    if (budget.remaining < 80) break;
  }

  const medicationChunks: string[] = [];
  for (const ev of evRows) {
    const stored = coerceMedicationsAndSupplementsForReview(ev.medicationsAndSupplements);
    if (!medicationsAndSupplementsHasContent(stored)) continue;
    const text = formatMedicationsAndSupplementsForDocument(stored);
    if (!text) continue;
    const dateStr = ev.date.toLocaleDateString("pt-BR");
    appendBudgetedBlock(
      medicationChunks,
      budget,
      `--- Medicamentos/Suplementos mencionados na evolução ${dateStr} ---\n`,
      sanitizeText(text).slice(0, CHAT_MAX_CHARS_PER_EXAM),
      80,
    );
    if (budget.remaining < 80) break;
  }

  const metricChunks: string[] = [];
  for (const m of metricRows) {
    const dateStr = m.date.toLocaleDateString("pt-BR");
    const unit = m.unit?.trim() ? ` ${m.unit.trim()}` : "";
    const reason = m.reasoning?.trim()
      ? ` — ${sanitizeText(m.reasoning).slice(0, 180)}`
      : "";
    appendBudgetedBlock(
      metricChunks,
      budget,
      `• ${dateStr}: `,
      `${m.name} = ${m.value}${unit}${reason}`,
      40,
    );
    if (budget.remaining < 40) break;
  }

  const highlights = parseClinicalCaseHighlightsStored(patient.clinicalCaseHighlights);

  return {
    patientId: patient.id,
    name: patient.name,
    age: patient.age,
    diagnosis: patient.diagnosis,
    clinicalSummary: patient.clinicalSummary?.trim() || null,
    highlightsBullets: highlights?.bullets ?? [],
    evolutionCount: patient._count.evolutions,
    examCount: patient._count.exams,
    evolutionBlock:
      evolutionChunks.join("\n\n") ||
      "(Sem texto registado nas evoluções — use ficha, resumo, exames e métricas.)",
    examsBlock:
      examChunks.join("\n\n") ||
      "(Nenhum exame/documento na pasta do paciente.)",
    medicationsBlock:
      medicationChunks.join("\n\n") ||
      "(Sem medicamentos ou suplementos estruturados nas evoluções recentes.)",
    metricsBlock:
      metricChunks.join("\n") ||
      "(Sem métricas clínicas estruturadas registradas.)",
    journalBlock: formatCareTimelineBlock(
      await loadSharedCareTimelineForChart({
        tenantUserId: userId,
        chartPatientId: patientId,
      }),
      { maxEvents: 16, chars: 900 },
    ),
  };
}

export function formatChatHistoryForPrompt(messages: ChatHistoryMessage[]): string {
  if (messages.length === 0) return "(Sem mensagens anteriores nesta conversa.)";
  return messages
    .map((m) => {
      const label = m.role === "user" ? "Profissional" : ESTER_AGENT_NAME;
      return `[${label}]: ${sanitizeText(m.content).slice(0, 4000)}`;
    })
    .join("\n\n");
}

export function buildClinicalChatSystemInstruction(
  profession?: string | null,
  withEvidence = false,
  evidenceQuotaExceeded = false,
  withOnDemandExam = false,
  withAgendaFinance = false,
): string {
  const prof = profession?.trim() ? ` O profissional é ${profession.trim()}.` : "";
  const evidenceRules = withEvidence
    ? `
7. Quando houver bloco EVIDÊNCIA EXTERNA, cite apenas essas referências numeradas [1], [2]… Não invente estudos nem URLs.
8. Diferencie claramente o que vem do prontuário do que vem da literatura externa.`
    : "";
  const quotaRules = evidenceQuotaExceeded
    ? `
9. A pergunta pede literatura, mas o limite mensal de buscas de evidência foi atingido. Responda só com o prontuário e o histórico desta conversa.
10. Informe brevemente que as referências externas não foram consultadas neste mês e que o limite renova no próximo mês civil (UTC).`
    : "";
  const examRules = withOnDemandExam
    ? `
${evidenceQuotaExceeded ? "11" : "9"}. Há bloco ANÁLISE SOB DEMANDA DO EXAME: use apenas achados extraídos do arquivo nesta mensagem; não invente valores de laboratório ou laudo.`
    : "";
  const agendaFinanceRules = withAgendaFinance
    ? `
${withOnDemandExam ? (evidenceQuotaExceeded ? "12" : "10") : evidenceQuotaExceeded ? "10" : "9"}. Há bloco(s) AGENDA e/ou FINANCEIRO DO PACIENTE injetados porque o profissional usou termos explícitos (marcação, pagamento, pacote, etc.). Use apenas esses dados administrativos; não invente horários, valores ou sessões.`
    : "";
  return `${ESTER_SYSTEM_IDENTITY} Você apoia a decisão clínica com base no prontuário.${prof}
Regras obrigatórias:
1. Use informações da ficha, resumo clínico, tópicos do caso, métricas, pasta de exames (resumos IA), medicamentos/suplementos mencionados nas evoluções, evoluções, linha do cuidado compartilhada (quando o paciente tiver concedido acesso) e histórico desta conversa. Relatos e consultas gravadas nessa linha são do mapa do paciente, distintos da evolução registrada por você.
2. Não invente diagnósticos, exames, medicamentos ou datas que não constem no contexto interno.
3. Não prescreva tratamentos nem substitua o julgamento clínico do profissional.
4. Responda em português brasileiro, com clareza e objetividade; pode usar markdown leve (listas, negrito).
5. Ao final, inclua uma linha de aviso: "*Apoio à decisão clínica — valide com seu julgamento profissional.*"
6. Se a pergunta não puder ser respondida com o contexto disponível, diga explicitamente o que falta.
7. Agenda e financeiro do paciente NÃO fazem parte do contexto padrão — só aparecem quando o profissional pede explicitamente (marcações, pagamento, pacote, etc.).${evidenceRules}${quotaRules}${examRules}${agendaFinanceRules}`.trim();
}

export function buildClinicalChatUserPrompt(
  context: PatientChatContext,
  history: ChatHistoryMessage[],
  userQuestion: string,
  evidenceCitations: ClinicalChatCitation[] = [],
  onDemandExam: OnDemandExamAnalysisBlock | null = null,
  onDemandExamNote: string | null = null,
  agendaBlock: string | null = null,
  financeBlock: string | null = null,
): string {
  const diag = context.diagnosis?.trim();
  const agePart = context.age?.trim() || "não informada";
  const summaryBlock = context.clinicalSummary
    ? `Resumo clínico (IA):\n${context.clinicalSummary}`
    : "(Sem resumo clínico gerado.)";
  const highlightsBlock =
    context.highlightsBullets.length > 0
      ? `Tópicos do caso:\n${context.highlightsBullets.map((b) => `• ${b}`).join("\n")}`
      : "";

  const metricsBlock = `Métricas clínicas (Evolução Visual — mais recentes primeiro):
${context.metricsBlock}`;

  const examsBlock = `Pasta Exames/Documentos (${context.examCount} arquivo(s); resumos IA quando disponíveis):
${context.examsBlock}`;

  const medicationsBlock = `Medicamentos e suplementos mencionados nas evoluções recentes:
${context.medicationsBlock}`;

  const evidenceBlock =
    evidenceCitations.length > 0
      ? `EVIDÊNCIA EXTERNA (referências recuperadas — cite só estas):
${formatEvidenceBlockForPrompt(evidenceCitations)}`
      : "";

  const onDemandExamBlock = onDemandExam
    ? `ANÁLISE SOB DEMANDA DO EXAME SOLICITADO (leitura do arquivo nesta mensagem):
--- ${onDemandExam.title} (${onDemandExam.dateLabel}) ---
${onDemandExam.analysisText}`
    : onDemandExamNote
      ? `NOTA SOBRE ANÁLISE DE EXAME SOLICITADA:\n${onDemandExamNote}`
      : "";

  const agendaFinanceBlocks = [agendaBlock, financeBlock].filter(Boolean).join("\n\n");

  return `Ficha do paciente:
- Nome: ${context.name}
- Idade: ${agePart}
${diag ? `- Diagnóstico na ficha: ${diag}` : ""}
- Total de evoluções: ${context.evolutionCount}
- Arquivos na pasta Exames: ${context.examCount}

${summaryBlock}

${highlightsBlock}

${metricsBlock}

${examsBlock}

${medicationsBlock}

Evoluções recentes (da mais recente para a mais antiga):
${context.evolutionBlock}

Linha do cuidado compartilhada (relatos e consultas gravadas, só se o paciente concedeu acesso):
${context.journalBlock}

Histórico desta conversa:
${formatChatHistoryForPrompt(history)}

${evidenceBlock}

${onDemandExamBlock}

${agendaFinanceBlocks}

Pergunta atual do profissional:
${sanitizeText(userQuestion)}`.trim();
}
