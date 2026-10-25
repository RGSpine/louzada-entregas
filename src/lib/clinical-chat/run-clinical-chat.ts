/**
 * Orquestração do chat clínico (Ester) — risco R0/R1/R2 + rota de modelo + evidência sob demanda.
 */
import { prisma } from "@/lib/prisma";
import { generateContentSafe } from "@/lib/gemini";
import { sanitizeText } from "@/lib/sanitize";
import { transcribeAgentMedia } from "@/lib/finance/agent-transcribe";
import { analyzeClinicalQuestion } from "@/lib/clinical-chat/analyze-question";
import {
  searchClinicalEvidence,
  isClinicalEvidenceSearchAvailable,
} from "@/lib/clinical-chat/evidence-search";
import type { ClinicalChatCitation } from "@/lib/clinical-chat/citations";
import {
  buildClinicalChatSystemInstruction,
  buildClinicalChatUserPrompt,
  buildPatientContextForChat,
  CHAT_HISTORY_MESSAGES,
  type ChatHistoryMessage,
} from "@/lib/clinical-chat/build-patient-context";
import { canRunClinicalChatEvidenceSearch } from "@/lib/clinical-chat/evidence-quota";
import { pruneClinicalChatMessages } from "@/lib/clinical-chat/retention";
import { loadPatientExamCatalog } from "@/lib/clinical-chat/exam-catalog";
import {
  detectRequestedExamAnalysis,
  runOnDemandExamAnalysis,
  type OnDemandExamAnalysisBlock,
} from "@/lib/clinical-chat/analyze-requested-exam";
import { buildAgendaFinanceContextForChat } from "@/lib/clinical-chat/build-agenda-finance-context-for-chat";
import { canAnalyzeImages } from "@/lib/plan-limits";
import {
  checkAiTokenBudget,
  classifyProOrchestratorRisk,
  getGenerativeModelForRoute,
  logGeminiUsage,
  modelIdForRoute,
  PRO_EMERGENCY_HINT,
  searchSemanticCache,
} from "@/lib/ai-orchestrator";

export type ClinicalChatRunInput = {
  userId: string;
  patientId: string;
  userPlan?: string | null;
  profession?: string | null;
  userEmail?: string | null;
  isInfluencer?: boolean;
  typedText: string;
  audio?: { mimeType: string; base64: string } | null;
};

export type ClinicalChatRunResult =
  | {
      ok: true;
      assistantMessage: string;
      transcript: string | null;
      sessionId: string;
      citations: ClinicalChatCitation[];
      evidenceSearchUsed: boolean;
      evidenceQuotaExceeded?: boolean;
      examAnalysisUsed?: boolean;
      agendaContextUsed?: boolean;
      financeContextUsed?: boolean;
    }
  | { ok: false; error: string };

function truncateSessionTitle(text: string): string {
  const clean = sanitizeText(text).replace(/\s+/g, " ").trim();
  if (clean.length <= 60) return clean;
  return `${clean.slice(0, 57)}...`;
}

export async function runClinicalChatRequest(
  input: ClinicalChatRunInput,
): Promise<ClinicalChatRunResult> {
  const { userId, patientId, userPlan, profession, userEmail, isInfluencer, typedText, audio } =
    input;

  const context = await buildPatientContextForChat(patientId, userId);
  if (!context) {
    return { ok: false, error: "Paciente não encontrado ou sem permissão de acesso." };
  }
  if (context.evolutionCount < 1) {
    return {
      ok: false,
      error: "Este paciente ainda não possui evoluções registradas.",
    };
  }

  let transcript: string | null = null;
  if (audio?.base64) {
    const mediaText = await transcribeAgentMedia({ audio, images: [] });
    transcript = mediaText || null;
  }

  const combinedText = [typedText, transcript].filter((s) => s && s.trim()).join("\n\n").trim();
  if (!combinedText) {
    return { ok: false, error: "Envie uma pergunta em texto ou áudio." };
  }

  const userContent = sanitizeText(combinedText);
  if (!userContent) {
    return { ok: false, error: "Mensagem vazia após sanitização." };
  }

  let session = await prisma.patientChatSession.findUnique({
    where: { userId_patientId: { userId, patientId } },
    select: { id: true, title: true },
  });

  if (!session) {
    session = await prisma.patientChatSession.create({
      data: {
        userId,
        patientId,
        title: truncateSessionTitle(userContent),
      },
      select: { id: true, title: true },
    });
  } else if (!session.title) {
    await prisma.patientChatSession.update({
      where: { id: session.id },
      data: { title: truncateSessionTitle(userContent) },
    });
  }

  const priorRows = await prisma.patientChatMessage.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: "desc" },
    take: CHAT_HISTORY_MESSAGES,
    select: { role: true, content: true },
  });

  const history: ChatHistoryMessage[] = priorRows
    .reverse()
    .map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    }));

  let evidenceCitations: ClinicalChatCitation[] = [];
  let evidenceSearchUsed = false;
  let evidenceSearchAttempted = false;
  let evidenceQuotaExceeded = false;
  let examAnalysisUsed = false;
  let onDemandExam: OnDemandExamAnalysisBlock | null = null;
  let onDemandExamNote: string | null = null;
  let agendaBlock: string | null = null;
  let financeBlock: string | null = null;
  let agendaContextUsed = false;
  let financeContextUsed = false;

  const decision = classifyProOrchestratorRisk(userContent);

  // FAQ de produto (Ester / evolução) — cache semântico, zero LLM.
  if (decision.intent === "product_faq") {
    const cacheHit = await searchSemanticCache(userContent);
    if (cacheHit) {
      const assistantMessage = sanitizeText(cacheHit.reply);
      await prisma.$transaction([
        prisma.patientChatMessage.create({
          data: {
            sessionId: session.id,
            role: "user",
            content: userContent,
            metadata: transcript ? { transcript } : undefined,
          },
        }),
        prisma.patientChatMessage.create({
          data: {
            sessionId: session.id,
            role: "assistant",
            content: assistantMessage,
            metadata: {
              orchestratorRisk: decision.risk,
              orchestratorIntent: decision.intent,
              pipeline: "pro-r0-semantic-cache",
              cacheScore: cacheHit.score,
            },
          },
        }),
        prisma.patientChatSession.update({
          where: { id: session.id },
          data: { updatedAt: new Date() },
        }),
      ]);
      await pruneClinicalChatMessages(session.id);
      return {
        ok: true,
        assistantMessage,
        transcript,
        sessionId: session.id,
        citations: [],
        evidenceSearchUsed: false,
      };
    }
  }

  const budget = await checkAiTokenBudget({
    userId,
    userPlan,
    email: userEmail,
    isInfluencer,
  });
  if (!budget.allowed) {
    return {
      ok: false,
      error:
        "Orçamento diário de IA deste plano foi atingido. Tente amanhã ou ajuste AI_TOKEN_BUDGET_* / plano.",
    };
  }

  const examCatalog = await loadPatientExamCatalog(patientId, userId);

  const [literatureAnalysis, examRequest, agendaFinanceBlocks] = await Promise.all([
    !decision.skipEvidence && isClinicalEvidenceSearchAvailable()
      ? analyzeClinicalQuestion(context, userContent)
      : Promise.resolve(null),
    decision.intent === "exam_file" || !decision.skipEvidence
      ? detectRequestedExamAnalysis(userContent, examCatalog)
      : Promise.resolve({
          wantsExamAnalysis: false as const,
          examId: null as string | null,
        }),
    buildAgendaFinanceContextForChat(patientId, userId, {
      agenda: decision.wantsAgenda,
      finance: decision.wantsFinance,
    }),
  ]);

  agendaBlock = agendaFinanceBlocks.agendaBlock;
  financeBlock = agendaFinanceBlocks.financeBlock;
  agendaContextUsed = decision.wantsAgenda && agendaBlock != null;
  financeContextUsed = decision.wantsFinance && financeBlock != null;

  if (literatureAnalysis?.needsLiterature && literatureAnalysis.searchQueries.length > 0) {
    const canSearch = await canRunClinicalChatEvidenceSearch(
      userId,
      userEmail,
      isInfluencer,
    );
    if (canSearch) {
      evidenceSearchAttempted = true;
      evidenceCitations = await searchClinicalEvidence(literatureAnalysis.searchQueries);
      evidenceSearchUsed = evidenceCitations.length > 0;
    } else {
      evidenceQuotaExceeded = true;
    }
  }

  if (examRequest.wantsExamAnalysis) {
    if (!canAnalyzeImages(userPlan, userEmail, isInfluencer)) {
      onDemandExamNote =
        "O profissional pediu análise de um exame anexado, mas a leitura de arquivos (PDF/imagem) não está disponível neste plano.";
    } else if (!examRequest.examId) {
      onDemandExamNote =
        "O profissional pediu análise de um exame anexado, mas não foi possível identificar qual arquivo. Indique o nome ou a data do exame na pasta.";
    } else {
      const examRun = await runOnDemandExamAnalysis(
        examRequest.examId,
        patientId,
        userId,
        userContent,
      );
      if (examRun.ok) {
        onDemandExam = examRun.block;
        examAnalysisUsed = true;
      } else {
        onDemandExamNote = examRun.userMessage;
      }
    }
  }

  // Exame sob demanda força rota avançada mesmo se classificador errou.
  const effectiveRoute =
    examAnalysisUsed || decision.intent === "exam_file"
      ? "Modelo_Avancado"
      : decision.route === "zero_llm"
        ? "Modelo_Economico"
        : decision.route;

  let systemInstruction = buildClinicalChatSystemInstruction(
    profession,
    evidenceSearchUsed,
    evidenceQuotaExceeded,
    examAnalysisUsed,
    agendaContextUsed || financeContextUsed,
  );
  if (decision.risk === "R2") {
    systemInstruction = `${PRO_EMERGENCY_HINT}\n\n${systemInstruction}`;
  }

  const userPrompt = buildClinicalChatUserPrompt(
    context,
    history,
    userContent,
    evidenceCitations,
    onDemandExam,
    onDemandExamNote,
    agendaContextUsed ? agendaBlock : null,
    financeContextUsed ? financeBlock : null,
  );

  const model = getGenerativeModelForRoute(effectiveRoute, { systemInstruction });
  if (!model) {
    return { ok: false, error: "Rota de modelo indisponível." };
  }
  const result = await generateContentSafe(model, userPrompt, 120_000, 1);
  logGeminiUsage(result, {
    service: "ester_reply",
    model: modelIdForRoute(effectiveRoute),
    surface: "pro",
    userId,
    meta: {
      risk: decision.risk,
      intent: decision.intent,
      route: effectiveRoute,
      evidenceSearchUsed,
    },
  });
  const rawAnswer = result.response.text();
  const assistantMessage = sanitizeText(
    typeof rawAnswer === "string" ? rawAnswer.trim() : "",
  );
  if (!assistantMessage) {
    return { ok: false, error: "Resposta vazia da IA. Tente reformular a pergunta." };
  }

  const assistantMeta = {
    orchestratorRisk: decision.risk,
    orchestratorIntent: decision.intent,
    modelRoute: effectiveRoute,
    ...(evidenceSearchAttempted
      ? {
          evidenceSearchAttempted: true,
          evidenceSearchUsed,
          citationCount: evidenceCitations.length,
        }
      : {}),
    ...(examAnalysisUsed ? { examAnalysisUsed: true, examId: onDemandExam?.examId } : {}),
    ...(agendaContextUsed ? { agendaContextUsed: true } : {}),
    ...(financeContextUsed ? { financeContextUsed: true } : {}),
    ...(evidenceQuotaExceeded ? { evidenceQuotaExceeded: true } : {}),
    ...(onDemandExamNote
      ? { examAnalysisRequested: true, examAnalysisNote: onDemandExamNote }
      : {}),
  };

  await prisma.$transaction([
    prisma.patientChatMessage.create({
      data: {
        sessionId: session.id,
        role: "user",
        content: userContent,
        metadata: transcript ? { transcript } : undefined,
      },
    }),
    prisma.patientChatMessage.create({
      data: {
        sessionId: session.id,
        role: "assistant",
        content: assistantMessage,
        citations: evidenceSearchUsed ? evidenceCitations : undefined,
        metadata: assistantMeta,
      },
    }),
    prisma.patientChatSession.update({
      where: { id: session.id },
      data: { updatedAt: new Date() },
    }),
  ]);

  await pruneClinicalChatMessages(session.id);

  return {
    ok: true,
    assistantMessage,
    transcript,
    sessionId: session.id,
    citations: evidenceSearchUsed ? evidenceCitations : [],
    evidenceSearchUsed,
    evidenceQuotaExceeded: evidenceQuotaExceeded || undefined,
    examAnalysisUsed: examAnalysisUsed || undefined,
    agendaContextUsed: agendaContextUsed || undefined,
    financeContextUsed: financeContextUsed || undefined,
  };
}
