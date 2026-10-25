import { prisma } from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import {
  generateContentSafe,
  getGeminiFastModel,
  GEMINI_FAST_MODEL,
  isGeminiConfigured,
} from "@/lib/gemini";
import { logger } from "@/lib/logger";
import { logGeminiUsage } from "@/lib/ai-usage";
import { analyzePatientHealthQuestion } from "@/lib/b2c/analyze-patient-health-question";
import { parseStoredConsultationStructured } from "@/lib/b2c/consultation-structured";
import { formatDailyHealthContextBlock } from "@/lib/b2c/daily-health";
import {
  formatHealthJournalBlock,
  listHealthJournal,
} from "@/lib/b2c/health-journal";
import {
  buildCareTimeline,
  formatCareTimelineBlock,
} from "@/lib/b2c/care-timeline";
import {
  formatManagerBlockForPrompt,
  runPatientHealthManager,
  type HealthManagerProfessionalSuggestion,
  type HealthManagerResult,
} from "@/lib/b2c/health-manager";
import type {
  HealthChatCitationView,
  HealthChatMessageView,
} from "@/lib/b2c/health-chat-display";

export type {
  HealthChatCitationView,
  HealthChatMessageView,
  HealthChatProfessionalSuggestion,
} from "@/lib/b2c/health-chat-display";
import {
  B2C_EMERGENCY_CANONICAL_REPLY,
  classifyB2cOrchestratorRisk,
  type B2cOrchestratorDecision,
} from "@/lib/b2c/orchestrator-risk";
import { tryBuildR0OperationalReply } from "@/lib/b2c/r0-operational-reply";
import { matchCanonicalProductFaqEntry } from "@/lib/b2c/canonical-faq";
import {
  putSemanticCache,
  searchSemanticCache,
} from "@/lib/b2c/semantic-cache";
import {
  isClinicalEvidenceSearchAvailable,
  searchClinicalEvidence,
} from "@/lib/clinical-chat/evidence-search";
import type { ClinicalChatCitation } from "@/lib/clinical-chat/citations";
import {
  ensureUniqueCitationIds,
  sanitizeClinicalChatCitations,
} from "@/lib/clinical-chat/citations";

/** Limite mensal de buscas de evidência por perfil (B2C). */
const B2C_EVIDENCE_MONTHLY_LIMIT = 40;

function patientAskedForReferences(text: string): boolean {
  return /\b(fonte|fontes|refer[eê]ncia|refer[eê]ncias|pubmed|perplexity|bibliograf|cite|citar|mostrar\s+as?\s+fontes|links?\s+cient[ií]ficos?)\b/i.test(
    text,
  );
}

function startEndUtcMonth(d = new Date()): { start: Date; end: Date } {
  const start = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0),
  );
  const end = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999),
  );
  return { start, end };
}

async function canRunB2cEvidenceSearch(
  healthProfileId: string,
): Promise<boolean> {
  const { start, end } = startEndUtcMonth();
  const session = await prisma.patientHealthChatSession.findUnique({
    where: { healthProfileId },
    select: { id: true },
  });
  if (!session) return true;
  const used = await prisma.patientHealthChatMessage.count({
    where: {
      sessionId: session.id,
      role: "assistant",
      createdAt: { gte: start, lte: end },
      metadata: {
        path: ["evidenceSearchAttempted"],
        equals: true,
      },
    },
  });
  return used < B2C_EVIDENCE_MONTHLY_LIMIT;
}

function citationsToView(
  citations: ClinicalChatCitation[],
): HealthChatCitationView[] {
  return ensureUniqueCitationIds(citations)
    .slice(0, 6)
    .map((item) => ({
      id: item.id,
      title: item.title,
      url: item.url,
      source: item.source,
      snippet: item.snippet ?? null,
    }));
}

function formatEvidenceBlock(citations: ClinicalChatCitation[]): string {
  if (citations.length === 0) return "(Sem citações externas nesta resposta.)";
  return citations
    .slice(0, 6)
    .map((item, index) => {
      const bits = [
        `${index + 1}. [${item.source}] ${item.title}`,
        item.url,
        item.snippet ? item.snippet.slice(0, 280) : null,
      ].filter(Boolean);
      return bits.join("\n");
    })
    .join("\n\n");
}

function concernNeedsEvidence(manager: HealthManagerResult): boolean {
  return manager.urgency === "soon" || manager.urgency === "urgent_care_advice";
}

/** Queries de reserva quando o gerenciador vê um problema e o classificador não devolveu busca. */
function fallbackEvidenceQueries(manager: HealthManagerResult): string[] {
  const topics = [...manager.symptoms, ...manager.specialtyHints]
    .map((item) => sanitizeText(item))
    .filter((item) => item.length >= 4)
    .slice(0, 2);
  return topics.map((topic) =>
    `clinical guidance patient concern ${topic}`.slice(0, 180),
  );
}

async function buildHealthContextBlock(
  healthProfileId: string,
  options?: { maxSummaries?: number; maxTasks?: number; includeRaw?: boolean },
): Promise<{
  contextBlock: string;
  anonymizedHint: string;
}> {
  const maxSummaries = options?.maxSummaries ?? 5;
  const maxTasks = options?.maxTasks ?? 8;
  const includeRaw = options?.includeRaw ?? false;

  const profile = await prisma.healthProfile.findUnique({
    where: { id: healthProfileId },
    select: {
      name: true,
      dateOfBirth: true,
      relationship: true,
      healthPanorama: true,
      patientId: true,
    },
  });

  const now = new Date();
  const slotSelect = {
    datetime: true,
    professional: {
      select: {
        user: { select: { name: true, profession: true } },
        specialties: {
          take: 1,
          select: { specialty: { select: { name: true } } },
        },
      },
    },
  } as const;

  const summaries = await prisma.clinicalSummary.findMany({
    where: { healthProfileId },
    orderBy: { createdAt: "desc" },
    take: maxSummaries,
    select: {
      translatedExplanation: true,
      originalText: true,
      sourceType: true,
      createdAt: true,
      structured: true,
    },
  });
  const tasks = await prisma.healthTask.findMany({
    where: { healthProfileId },
    orderBy: [{ isCompleted: "asc" }, { scheduledTime: "asc" }],
    take: maxTasks,
    select: {
      title: true,
      type: true,
      isCompleted: true,
      scheduledTime: true,
    },
  });
  const upcomingSlots = profile
    ? await prisma.scheduleSlot.findMany({
        where: {
          patientId: profile.patientId,
          status: "BOOKED",
          datetime: { gte: now },
        },
        orderBy: { datetime: "asc" },
        take: 8,
        select: slotSelect,
      })
    : [];
  const pastSlots = profile
    ? await prisma.scheduleSlot.findMany({
        where: {
          patientId: profile.patientId,
          status: "BOOKED",
          datetime: { lt: now },
        },
        orderBy: { datetime: "desc" },
        take: 6,
        select: slotSelect,
      })
    : [];

  const summaryBlock =
    summaries.length === 0
      ? "(Sem consultas ou arquivos ainda — oriente a gravar a consulta ou enviar o laudo.)"
      : summaries
          .map((item, index) => {
            const date = item.createdAt.toLocaleDateString("pt-BR");
            const source = item.sourceType ?? "manual";
            const structured = parseStoredConsultationStructured(item.structured);
            const isFile =
              source === "exam_ocr" || source === "consultation_bundle";
            const saidLimit = includeRaw ? 900 : 700;
            const fileLimit = includeRaw ? 700 : 420;
            const said = item.translatedExplanation.slice(0, saidLimit).trim();
            const fileText = isFile
              ? item.originalText.slice(0, fileLimit).trim()
              : includeRaw
                ? item.originalText.slice(0, 280).trim()
                : "";
            return [
              `${index + 1}. [${date} · ${source}]`,
              structured.professionalName
                ? `Profissional: ${structured.professionalName}${structured.specialty ? ` (${structured.specialty})` : ""}`
                : null,
              said ? `O que foi dito / explicado: ${said}` : null,
              fileText
                ? `Conteúdo do arquivo ou trecho registrado: ${fileText}`
                : null,
              structured.recommendations.length
                ? `Recomendações: ${structured.recommendations.slice(0, 4).join("; ")}`
                : null,
              structured.attentionPoints.length
                ? `Pontos de atenção: ${structured.attentionPoints.slice(0, 4).join("; ")}`
                : null,
              structured.orientations.length
                ? `Orientações: ${structured.orientations.slice(0, 4).join("; ")}`
                : null,
            ]
              .filter(Boolean)
              .join("\n");
          })
          .join("\n\n");

  function formatSlotLine(
    slot: (typeof upcomingSlots)[number],
    index: number,
  ): string {
    const specialty =
      slot.professional.specialties[0]?.specialty.name ??
      slot.professional.user.profession ??
      "especialidade não informada";
    const name = slot.professional.user.name?.trim() || "Profissional";
    return `${index + 1}. ${slot.datetime.toLocaleString("pt-BR")} · ${name} · ${specialty}`;
  }

  const upcomingBlock =
    upcomingSlots.length === 0
      ? "(Nenhuma consulta marcada.)"
      : upcomingSlots.map(formatSlotLine).join("\n");

  const pastBlock =
    pastSlots.length === 0
      ? "(Nenhuma consulta já realizada na agenda.)"
      : pastSlots.map(formatSlotLine).join("\n");

  const taskBlock =
    tasks.length === 0
      ? "(Sem atividades registradas.)"
      : tasks
          .map((task, index) => {
            const when = task.scheduledTime
              ? task.scheduledTime.toLocaleString("pt-BR")
              : "sem data";
            const status = task.isCompleted ? "feita" : "pendente";
            return `${index + 1}. [${task.type} · ${status} · ${when}] ${task.title}`;
          })
          .join("\n");

  const pendingTasks = tasks.filter((task) => !task.isCompleted);

  const ageHint = profile?.dateOfBirth
    ? `${new Date().getUTCFullYear() - profile.dateOfBirth.getUTCFullYear()} anos (aprox.)`
    : "idade não informada";

  const topicsFromSummaries = summaries
    .slice(0, 3)
    .map((s) => s.translatedExplanation.slice(0, 120))
    .join(" | ");

  const anonymizedHint = [
    `Idade aproximada: ${ageHint}`,
    `Relação do perfil: ${profile?.relationship ?? "self"}`,
    `Resumos no mapa: ${summaries.length}`,
    `Tarefas pendentes: ${pendingTasks.length}`,
    topicsFromSummaries
      ? `Temas recentes (sem nomes): ${topicsFromSummaries}`
      : "Sem temas clínicos ainda.",
  ].join("\n");

  const dailyBlock = await formatDailyHealthContextBlock(healthProfileId);
  const journalEntries = await listHealthJournal(healthProfileId, 12);
  const careTimeline = await buildCareTimeline(healthProfileId, 16);
  const journalBlock = formatHealthJournalBlock(journalEntries);
  const careTimelineBlock = formatCareTimelineBlock(careTimeline);
  const panorama = (profile?.healthPanorama?.trim() || "").slice(0, 1600);

  const contextBlock = `Perfil: ${profile?.name ?? "Paciente"} (${profile?.relationship ?? "self"})
Nascimento: ${
    profile?.dateOfBirth
      ? profile.dateOfBirth.toISOString().slice(0, 10)
      : "não informado"
  }

ESTADO GERAL (panorama extraído pela IA):
${panorama || "(Ainda sem panorama.)"}

CHECK-IN DIÁRIO (complementar, opcional — água, sono, urina, Bristol, atividade, relógio):
${dailyBlock}

LINHA DO CUIDADO (ordem cronológica — a mesma que o paciente vê e que o profissional escolhido recebe):
${careTimelineBlock}

RELATO DO PACIENTE (palavras dele, não do profissional):
${journalBlock}

AGENDA — PRÓXIMAS CONSULTAS:
${upcomingBlock}

AGENDA — CONSULTAS JÁ REALIZADAS:
${pastBlock}

O QUE FOI DITO E ARQUIVOS (consultas, áudios e laudos):
${summaryBlock}

ÚLTIMAS ATIVIDADES:
${taskBlock}`;

  return { contextBlock, anonymizedHint };
}

export async function getOrCreateHealthChatSession(healthProfileId: string) {
  const existing = await prisma.patientHealthChatSession.findUnique({
    where: { healthProfileId },
    select: { id: true },
  });
  if (existing) return existing;
  return prisma.patientHealthChatSession.create({
    data: { healthProfileId },
    select: { id: true },
  });
}

function mapMessage(message: {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
  metadata?: unknown;
}): HealthChatMessageView {
  const meta =
    message.metadata && typeof message.metadata === "object"
      ? (message.metadata as Record<string, unknown>)
      : null;
  const showCitations = Boolean(meta?.showCitations);
  const citations =
    showCitations && meta?.citations
      ? sanitizeClinicalChatCitations(meta.citations).map((item) => ({
          id: item.id,
          title: item.title,
          url: item.url,
          source: item.source,
          snippet: item.snippet ?? null,
        }))
      : undefined;
  const professionalSuggestions = Array.isArray(meta?.professionalSuggestions)
    ? (meta.professionalSuggestions as HealthManagerProfessionalSuggestion[])
    : undefined;
  const conclusions = Array.isArray(meta?.conclusions)
    ? (meta.conclusions as string[])
    : undefined;
  const urgency =
    meta?.urgency === "routine" ||
    meta?.urgency === "soon" ||
    meta?.urgency === "urgent_care_advice"
      ? meta.urgency
      : undefined;
  return {
    id: message.id,
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    citations,
    evidenceSearchUsed: Boolean(meta?.evidenceSearchUsed),
    showCitations,
    professionalSuggestions,
    conclusions,
    urgency,
  };
}

export async function listHealthChatMessages(
  healthProfileId: string,
): Promise<HealthChatMessageView[]> {
  const session = await prisma.patientHealthChatSession.findUnique({
    where: { healthProfileId },
    select: {
      messages: {
        orderBy: { createdAt: "asc" },
        take: 80,
        select: {
          id: true,
          role: true,
          content: true,
          createdAt: true,
          metadata: true,
        },
      },
    },
  });
  if (!session) return [];
  return session.messages.map(mapMessage);
}

export type RunHealthChatResult =
  | {
      success: true;
      reply: string;
      messages: HealthChatMessageView[];
      citations: HealthChatCitationView[];
      evidenceSearchUsed: boolean;
      professionalSuggestions: HealthManagerProfessionalSuggestion[];
      conclusions: string[];
    }
  | { success: false; error: string };

const EMPTY_MANAGER: HealthManagerResult = {
  symptoms: [],
  specialtyHints: [],
  urgency: "routine",
  conclusions: [],
  panoramaUpdate: null,
  matchRationale: null,
  professionals: [],
  engine: "none",
};

async function persistAssistantAndReturn(input: {
  healthProfileId: string;
  sessionId: string;
  reply: string;
  showCitations: boolean;
  citationViews: HealthChatCitationView[];
  evidenceSearchAttempted: boolean;
  evidenceSearchUsed: boolean;
  evidenceQuotaExceeded: boolean;
  professionals: HealthManagerProfessionalSuggestion[];
  conclusions: string[];
  urgency: HealthManagerResult["urgency"];
  managerEngine: HealthManagerResult["engine"];
  orchestrator: B2cOrchestratorDecision;
  pipeline: string;
}): Promise<Extract<RunHealthChatResult, { success: true }>> {
  const reply = sanitizeText(input.reply).slice(0, 8_000);
  await prisma.patientHealthChatMessage.create({
    data: {
      sessionId: input.sessionId,
      role: "assistant",
      content: reply,
      metadata: {
        evidenceSearchAttempted: input.evidenceSearchAttempted,
        evidenceSearchUsed: input.evidenceSearchUsed,
        evidenceQuotaExceeded: input.evidenceQuotaExceeded,
        showCitations: input.showCitations,
        citations: input.citationViews,
        professionalSuggestions: input.professionals,
        conclusions: input.conclusions,
        urgency: input.urgency,
        managerEngine: input.managerEngine,
        orchestratorRisk: input.orchestrator.risk,
        orchestratorIntent: input.orchestrator.intent,
        pipeline: input.pipeline,
      },
    },
  });
  await prisma.patientHealthChatSession.update({
    where: { id: input.sessionId },
    data: { updatedAt: new Date() },
  });

  const messages = await listHealthChatMessages(input.healthProfileId);
  return {
    success: true,
    reply,
    messages,
    citations: input.showCitations ? input.citationViews : [],
    evidenceSearchUsed: input.evidenceSearchUsed,
    professionalSuggestions: input.professionals,
    conclusions: input.conclusions,
  };
}

/**
 * Assessor B2C orquestrado (Fase A):
 * R2 protocolo fixo → R0 Prisma/FAQ/vitrine → R1 Flash + manager enxuto (± evidência).
 */
export async function runPatientHealthChat(input: {
  healthProfileId: string;
  userText: string;
}): Promise<RunHealthChatResult> {
  const text = sanitizeText(input.userText).slice(0, 4000);
  if (!text) {
    return { success: false, error: "Escreva sua pergunta." };
  }

  const decision = classifyB2cOrchestratorRisk(text);
  const showCitations = patientAskedForReferences(text);

  try {
    const session = await getOrCreateHealthChatSession(input.healthProfileId);
    await prisma.patientHealthChatMessage.create({
      data: {
        sessionId: session.id,
        role: "user",
        content: text,
      },
    });

    // —— R2: emergência sem LLM ——
    if (decision.risk === "R2") {
      return persistAssistantAndReturn({
        healthProfileId: input.healthProfileId,
        sessionId: session.id,
        reply: B2C_EMERGENCY_CANONICAL_REPLY,
        showCitations: false,
        citationViews: [],
        evidenceSearchAttempted: false,
        evidenceSearchUsed: false,
        evidenceQuotaExceeded: false,
        professionals: [],
        conclusions: ["Orientação de emergência (protocolo fixo)."],
        urgency: "urgent_care_advice",
        managerEngine: "none",
        orchestrator: decision,
        pipeline: "r2-canonical",
      });
    }

    // —— R0: cache semântico → zero-LLM → Flash leve ——
    if (decision.risk === "R0") {
      const cacheHit = await searchSemanticCache(text);
      if (cacheHit) {
        return persistAssistantAndReturn({
          healthProfileId: input.healthProfileId,
          sessionId: session.id,
          reply: cacheHit.reply,
          showCitations: false,
          citationViews: [],
          evidenceSearchAttempted: false,
          evidenceSearchUsed: false,
          evidenceQuotaExceeded: false,
          professionals: [],
          conclusions: [
            `Cache semântico (${cacheHit.source}, score ${cacheHit.score.toFixed(2)})`,
          ],
          urgency: "routine",
          managerEngine: "none",
          orchestrator: decision,
          pipeline: "r0-semantic-cache",
        });
      }

      const r0 = await tryBuildR0OperationalReply({
        healthProfileId: input.healthProfileId,
        userText: text,
        decision,
      });
      if (r0) {
        const faq = matchCanonicalProductFaqEntry(text);
        if (faq || decision.wantsProductFaq) {
          void putSemanticCache({
            userText: text,
            reply: r0.reply,
            intent: faq ? `product_faq:${faq.id}` : decision.intent,
          });
        }
        return persistAssistantAndReturn({
          healthProfileId: input.healthProfileId,
          sessionId: session.id,
          reply: r0.reply,
          showCitations: false,
          citationViews: [],
          evidenceSearchAttempted: false,
          evidenceSearchUsed: false,
          evidenceQuotaExceeded: false,
          professionals: r0.professionals,
          conclusions: r0.conclusions,
          urgency: "routine",
          managerEngine: "none",
          orchestrator: decision,
          pipeline: "r0-zero-llm",
        });
      }
      // R0 sem material: Flash leve, sem manager/evidência
      if (!isGeminiConfigured()) {
        return { success: false, error: "IA temporariamente indisponível." };
      }
      const { contextBlock } = await buildHealthContextBlock(
        input.healthProfileId,
        { maxSummaries: 2, maxTasks: 5, includeRaw: false },
      );
      const model = getGeminiFastModel({
        systemInstruction: `Você é o assistente do Mapa de Saúde (Louzada Entregas). Resposta operacional curta em pt-BR.
Use só o contexto. Não invente exames/diagnósticos. Não substitui consulta. Sem JSON.`,
        generationConfig: { temperature: 0.3 },
      });
      const result = await generateContentSafe(
        model,
        `CONTEXTO COMPACTO:\n${contextBlock}\n\nPERGUNTA:\n${text}`,
        60_000,
        1,
      );
      logGeminiUsage(result, {
        service: "b2c_chat_reply",
        model: GEMINI_FAST_MODEL,
        surface: "patient",
        meta: { pipeline: "r0-flash-light", risk: "R0" },
      });
      return persistAssistantAndReturn({
        healthProfileId: input.healthProfileId,
        sessionId: session.id,
        reply:
          result.response.text() ||
          "Não consegui responder agora. Tente de novo em instantes.",
        showCitations: false,
        citationViews: [],
        evidenceSearchAttempted: false,
        evidenceSearchUsed: false,
        evidenceQuotaExceeded: false,
        professionals: [],
        conclusions: [],
        urgency: "routine",
        managerEngine: "none",
        orchestrator: decision,
        pipeline: "r0-flash-light",
      });
    }

    // —— R1: manager enxuto + Flash redação (± evidência) ——
    if (!isGeminiConfigured()) {
      return { success: false, error: "IA temporariamente indisponível." };
    }

    const historyLimit = 10;
    const { contextBlock, anonymizedHint } = await buildHealthContextBlock(
      input.healthProfileId,
      {
        maxSummaries: 8,
        maxTasks: 12,
        includeRaw: true,
      },
    );
    const history = await prisma.patientHealthChatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "desc" },
      take: historyLimit,
      select: { role: true, content: true },
    });
    const manager = await runPatientHealthManager({
      healthProfileId: input.healthProfileId,
      userQuestion: text,
      persistPanorama: true,
      includeCatalog: decision.wantsProfessional,
    });

    let evidenceCitations: ClinicalChatCitation[] = [];
    let evidenceSearchAttempted = false;
    let evidenceSearchUsed = false;
    let evidenceQuotaExceeded = false;

    if (isClinicalEvidenceSearchAvailable()) {
      const analysis = await analyzePatientHealthQuestion(
        anonymizedHint,
        text,
      );
      const flaggedConcern = concernNeedsEvidence(manager);
      const shouldGround = analysis.needsLiterature || flaggedConcern;
      const searchQueries =
        analysis.searchQueries.length > 0
          ? analysis.searchQueries
          : flaggedConcern
            ? fallbackEvidenceQueries(manager)
            : [];
      if (shouldGround && searchQueries.length > 0) {
        const canSearch = await canRunB2cEvidenceSearch(input.healthProfileId);
        if (canSearch) {
          evidenceSearchAttempted = true;
          evidenceCitations = await searchClinicalEvidence(searchQueries, {
            maxQueries: 2,
            maxCitations: 6,
          });
          evidenceSearchUsed = evidenceCitations.length > 0;
        } else {
          evidenceQuotaExceeded = true;
        }
      }
    }

    const historyChronological = [...history].reverse();
    const historyText = historyChronological
      .map(
        (item) =>
          `${item.role === "assistant" ? "Assistente" : "Paciente"}: ${item.content}`,
      )
      .join("\n");

    const managerOrEmpty =
      manager.engine === "none" ? EMPTY_MANAGER : manager;

    const systemInstruction = `Você é o assistente clínico do paciente no Louzada Entregas — o mesmo papel de compilado que a Ester faz para o profissional, só que em linguagem leiga e só deste perfil.
Pipeline: mapa completo · Gemini Flash (± DeepSeek no gerenciador) · PubMed/Perplexity para embasar problema.

Papel:
- Use o compilado inteiro: estado geral, check-in diário (água, sono, urina, Bristol, atividade e relógio, se houver), agenda, o que os profissionais disseram, arquivos/laudos e atividades.
- O check-in e o relógio complementam o panorama. Não trate ausência deles como falha.
- A LINHA DO CUIDADO é a ordem dos relatos e das consultas gravadas. Use essa sequência ao responder. Cruze com exames e check-in. Se o padrão sugerir que ele procure alguém, diga isso com clareza e use a vitrine quando houver match. Não transforme o relato em diagnóstico.
- Pode opinar em tempo real, conectando esses dados. Não invente consulta, exame ou orientação que não esteja no compilado.
- Se apontar problema, falha, inconsistência ou risco, o raciocínio DEVE se apoiar no bloco EVIDÊNCIA (PubMed/Perplexity). Sem esse bloco, diga que a opinião fica só no que já está no mapa.
- Não liste links, títulos de artigos nem “fontes”${
      showCitations
        ? ", EXCETO agora: o paciente pediu referências — cite com parcimônia, só as do bloco EVIDÊNCIA"
        : ". A evidência embasa você; a pessoa não precisa ver a referência."
    }
- Use CONCLUSÕES DO GERENCIADOR e profissionais sugeridos quando houver match.
- Se urgency=urgent_care_advice, priorize orientação de emergência/pronto-socorro.
- Não invente profissionais fora da lista do gerenciador; diga para abrir a vitrine se não houver match.
- Linguagem clara; não substitui consulta presencial.
- Responda em português do Brasil, texto corrido (sem JSON).
${evidenceQuotaExceeded ? "\nNota: cota de literatura esgotada — não afirme fato científico novo; fique no mapa." : ""}`;

    const model = getGeminiFastModel({
      systemInstruction,
      generationConfig: { temperature: 0.35 },
    });

    const prompt = `COMPILADO DO MAPA DE SAÚDE:
${contextBlock}

GERENCIADOR:
${formatManagerBlockForPrompt(managerOrEmpty)}

EVIDÊNCIA PARA EMBASAR (PubMed / Perplexity — uso interno; não copie os links na resposta${showCitations ? ", salvo o pedido explícito de fontes" : ""}):
${formatEvidenceBlock(evidenceCitations)}

HISTÓRICO RECENTE:
${historyText || "(vazio)"}

Responda à última mensagem conectando estado, agenda, o que foi dito, arquivos e, se houver problema, a evidência acima.`;

    const result = await generateContentSafe(model, prompt, 120_000, 1);
    logGeminiUsage(result, {
      service: "b2c_chat_reply",
      model: GEMINI_FAST_MODEL,
      surface: "patient",
      meta: {
        pipeline: "r1-manager-flash",
        risk: "R1",
        wantsProfessional: decision.wantsProfessional,
        evidenceSearchUsed,
      },
    });
    const citationViews = citationsToView(evidenceCitations);

    return persistAssistantAndReturn({
      healthProfileId: input.healthProfileId,
      sessionId: session.id,
      reply:
        result.response.text() ||
        "Não consegui formular uma resposta agora. Tente de novo em instantes.",
      showCitations,
      citationViews,
      evidenceSearchAttempted,
      evidenceSearchUsed,
      evidenceQuotaExceeded,
      professionals: manager.professionals,
      conclusions: manager.conclusions,
      urgency: manager.urgency,
      managerEngine: manager.engine,
      orchestrator: decision,
      pipeline: "r1-manager-flash",
    });
  } catch (error) {
    logger.error("Falha no chat de saúde B2C", {
      feature: "b2c-health-chat",
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: "Não foi possível responder agora." };
  }
}
