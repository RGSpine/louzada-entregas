import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import {
  generateContentSafe,
  getGeminiFastModel,
  GEMINI_FAST_MODEL,
  isGeminiConfigured,
} from "@/lib/gemini";
import {
  generateTextWithDeepSeekDetailed,
  isDeepSeekConfigured,
} from "@/lib/deepseek";
import { logAiUsage, logGeminiUsage } from "@/lib/ai-usage";
import {
  getMarketplaceShowcaseProfessionals,
  showcaseListingId,
  type ShowcaseProfessional,
} from "@/lib/marketplace/showcase-data";
import { logger } from "@/lib/logger";
import { parseStoredConsultationStructured } from "@/lib/b2c/consultation-structured";
import {
  applyPanoramaRejection,
  readPanoramaReview,
} from "@/lib/b2c/patient-clinical-review";
import { formatDailyHealthContextBlock } from "@/lib/b2c/daily-health";
import {
  formatHealthJournalBlock,
  listHealthJournal,
} from "@/lib/b2c/health-journal";
import { managerDraftNeedsDeepSeekRefine } from "@/lib/b2c/manager-refine-policy";

export { managerDraftNeedsDeepSeekRefine } from "@/lib/b2c/manager-refine-policy";

const managerAnalysisSchema = z.object({
  symptoms: z.array(z.string().max(200)).max(12).default([]),
  specialtyHints: z.array(z.string().max(120)).max(8).default([]),
  urgency: z
    .enum(["routine", "soon", "urgent_care_advice"])
    .default("routine"),
  conclusions: z.array(z.string().max(500)).max(8).default([]),
  panoramaUpdate: z.string().max(2000).nullable().optional(),
  suggestedProfileIds: z.array(z.string().max(64)).max(5).default([]),
  matchRationale: z.string().max(800).nullable().optional(),
});

export type HealthManagerProfessionalSuggestion = {
  profileId: string;
  name: string;
  profession: string | null;
  specialty: string | null;
  headline: string | null;
  city: string | null;
  state: string | null;
  nextSlotId: string | null;
  nextSlotAt: string | null;
  effectivePrice: number | null;
  reason: string;
};

export type HealthManagerResult = {
  symptoms: string[];
  specialtyHints: string[];
  urgency: "routine" | "soon" | "urgent_care_advice";
  conclusions: string[];
  panoramaUpdate: string | null;
  matchRationale: string | null;
  professionals: HealthManagerProfessionalSuggestion[];
  engine: "gemini-flash+deepseek" | "gemini-flash" | "none";
};

function stripJsonFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function cleanList(items: string[], max = 12): string[] {
  return items
    .map((item) => sanitizeText(item).slice(0, 500))
    .filter(Boolean)
    .slice(0, max);
}

/** Memória compacta (Fase A): top-N, sem OCR bruto. */
async function buildMemoryPack(
  healthProfileId: string,
  options?: { maxSummaries?: number; maxTasks?: number },
): Promise<string> {
  const maxSummaries = options?.maxSummaries ?? 3;
  const maxTasks = options?.maxTasks ?? 8;

  const profile = await prisma.healthProfile.findUnique({
    where: { id: healthProfileId },
    select: {
      name: true,
      relationship: true,
      dateOfBirth: true,
      healthPanorama: true,
    },
  });
  const summaries = await prisma.clinicalSummary.findMany({
    where: { healthProfileId },
    orderBy: { createdAt: "desc" },
    take: maxSummaries,
    select: {
      translatedExplanation: true,
      sourceType: true,
      createdAt: true,
      structured: true,
    },
  });
  const tasks = await prisma.healthTask.findMany({
    where: { healthProfileId, isCompleted: false },
    orderBy: { createdAt: "desc" },
    take: maxTasks,
    select: { title: true, type: true, scheduledTime: true },
  });

  const consultBlock =
    summaries.length === 0
      ? "(Sem consultas/exames na memória.)"
      : summaries
          .map((item, index) => {
            const structured = parseStoredConsultationStructured(item.structured);
            const bits = [
              `${index + 1}. ${item.createdAt.toLocaleDateString("pt-BR")} · ${item.sourceType ?? "registro"}`,
              structured.professionalName
                ? `Profissional: ${structured.professionalName}${structured.specialty ? ` (${structured.specialty})` : ""}`
                : null,
              `Resumo: ${item.translatedExplanation.slice(0, 500)}`,
              structured.recommendations.length
                ? `Recomendações: ${structured.recommendations.slice(0, 3).join("; ")}`
                : null,
              structured.attentionPoints.length
                ? `Atenção: ${structured.attentionPoints.slice(0, 3).join("; ")}`
                : null,
            ].filter(Boolean);
            return bits.join("\n");
          })
          .join("\n\n");

  const taskBlock =
    tasks.length === 0
      ? "(Sem tarefas pendentes.)"
      : tasks
          .map(
            (task, i) =>
              `${i + 1}. [${task.type}] ${task.title}${
                task.scheduledTime
                  ? ` · ${task.scheduledTime.toLocaleString("pt-BR")}`
                  : ""
              }`,
          )
          .join("\n");

  const panorama = (profile?.healthPanorama?.trim() || "(vazio)").slice(0, 800);
  const dailyBlock = await formatDailyHealthContextBlock(healthProfileId);
  const journalEntries = await listHealthJournal(healthProfileId, 8);
  const journalBlock = formatHealthJournalBlock(journalEntries);

  return `Perfil: ${profile?.name ?? "Paciente"} (${profile?.relationship ?? "self"})
Nascimento: ${
    profile?.dateOfBirth
      ? profile.dateOfBirth.toISOString().slice(0, 10)
      : "não informado"
  }
Panorama atual:
${panorama}

Check-in diário (complementar):
${dailyBlock}

Relato do paciente:
${journalBlock}

Memória (consultas/exames recentes):
${consultBlock}

Tarefas pendentes:
${taskBlock}`;
}

function catalogBlock(catalog: ShowcaseProfessional[]): string {
  if (catalog.length === 0) {
    return "(Vitrine sem profissionais cadastrados agora.)";
  }
  return catalog
    .slice(0, 12)
    .map((pro, index) => {
      const specs = pro.specialties.slice(0, 4).join(", ") || "geral";
      const next = pro.slots[0];
      return `${index + 1}. profileId=${showcaseListingId(pro)} | ${pro.name} | profissão=${pro.profession ?? "n/d"} | especialidades=${specs} | cidade=${pro.city ?? "n/d"} | próximoSlot=${next ? `${next.datetime} R$${next.effectivePrice}` : "sem slot"}`;
    })
    .join("\n");
}

function matchProfessionals(
  catalog: ShowcaseProfessional[],
  suggestedIds: string[],
  specialtyHints: string[],
  rationale: string | null,
): HealthManagerProfessionalSuggestion[] {
  const byId = new Map(catalog.map((pro) => [showcaseListingId(pro), pro]));
  const picked: ShowcaseProfessional[] = [];

  for (const id of suggestedIds) {
    const pro = byId.get(id);
    if (pro && !picked.some((p) => showcaseListingId(p) === showcaseListingId(pro))) {
      picked.push(pro);
    }
  }

  if (picked.length < 3 && specialtyHints.length > 0) {
    const hints = specialtyHints.map((h) => h.toLowerCase());
    for (const pro of catalog) {
      if (picked.length >= 3) break;
      const hay = [
        pro.profession ?? "",
        pro.publicHeadline ?? "",
        ...pro.specialties,
      ]
        .join(" ")
        .toLowerCase();
      if (hints.some((hint) => hint.length >= 3 && hay.includes(hint))) {
        if (!picked.some((p) => showcaseListingId(p) === showcaseListingId(pro))) {
          picked.push(pro);
        }
      }
    }
  }

  return picked.slice(0, 3).map((pro) => {
    const next = pro.slots[0] ?? null;
    return {
      profileId: showcaseListingId(pro),
      name: pro.name,
      profession: pro.profession,
      specialty: pro.specialties[0] ?? pro.profession,
      headline: pro.publicHeadline,
      city: pro.city,
      state: pro.state,
      nextSlotId: next?.id ?? null,
      nextSlotAt: next?.datetime ?? null,
      effectivePrice: next?.effectivePrice ?? null,
      reason:
        rationale?.slice(0, 280) ||
        `Alinhado às especialidades: ${(pro.specialties[0] ?? pro.profession ?? "cuidado geral").toString()}`,
    };
  });
}

async function runGeminiFlashAnalysis(
  memory: string,
  catalog: ShowcaseProfessional[],
  userQuestion: string | null,
  includeCatalog: boolean,
): Promise<z.infer<typeof managerAnalysisSchema> | null> {
  if (!isGeminiConfigured()) return null;

  const systemInstruction = includeCatalog
    ? `Você é o núcleo de gestão de saúde do paciente no Louzada Entregas (Gemini 2.5 Flash).
Cruze a MEMÓRIA do paciente com a VITRINE de profissionais disponíveis.
Regras:
1) Não invente dados clínicos nem profileIds fora da lista.
2) suggestedProfileIds: só IDs listados na vitrine (máx. 3).
3) specialtyHints: nomes de especialidade em português.
4) urgency=urgent_care_advice só se houver sinais de gravidade (dor intensa súbita, falta de ar, etc.) — oriente emergência, não só vitrine.
5) conclusions: 2–5 frases práticas conectando histórico + pergunta atual.
6) panoramaUpdate: síntese curta do estado geral (ou null).
7) Responda APENAS JSON válido.`
    : `Você é o núcleo de gestão de saúde do paciente no Louzada Entregas (Gemini 2.5 Flash).
Analise só a MEMÓRIA e a pergunta — NÃO há vitrine nesta rodada.
Regras:
1) Não invente dados clínicos.
2) suggestedProfileIds: sempre [].
3) specialtyHints: especialidades úteis se fizer sentido (máx. 4), senão [].
4) urgency=urgent_care_advice só com sinais de gravidade.
5) conclusions: 2–5 frases práticas.
6) panoramaUpdate: síntese curta ou null.
7) matchRationale: null.
8) Responda APENAS JSON válido.`;

  const vitrineBlock = includeCatalog
    ? `VITRINE (profissionais com horários):
${catalogBlock(catalog)}`
    : `VITRINE: (omitida nesta rodada — não sugerir profileIds)`;

  const userPrompt = `MEMÓRIA DO PACIENTE:
${memory}

${vitrineBlock}

PERGUNTA / EVENTO ATUAL:
${userQuestion?.trim() || "(atualização após novo registro na memória)"}

JSON:
{"symptoms":[],"specialtyHints":[],"urgency":"routine","conclusions":[],"panoramaUpdate":null,"suggestedProfileIds":[],"matchRationale":null}`;

  try {
    const model = getGeminiFastModel({
      systemInstruction,
      generationConfig: { temperature: 0.25 },
    });
    const result = await generateContentSafe(model, userPrompt, 90_000, 1);
    logGeminiUsage(result, {
      service: "b2c_manager",
      model: GEMINI_FAST_MODEL,
      surface: "patient",
      meta: { phase: "flash", includeCatalog },
    });
    const parsed = managerAnalysisSchema.safeParse(
      JSON.parse(stripJsonFences(result.response.text())),
    );
    return parsed.success ? parsed.data : null;
  } catch (error) {
    logger.warn("health-manager: Gemini Flash falhou", {
      feature: "b2c-health-manager",
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** DeepSeek só se configurado e o rascunho Flash precisar de refine. */
export function shouldRefineManagerWithDeepSeek(
  draft: z.infer<typeof managerAnalysisSchema>,
  includeCatalog: boolean,
): boolean {
  return (
    isDeepSeekConfigured() &&
    managerDraftNeedsDeepSeekRefine(draft, includeCatalog)
  );
}

async function refineWithDeepSeek(
  memory: string,
  catalog: ShowcaseProfessional[],
  draft: z.infer<typeof managerAnalysisSchema>,
  userQuestion: string | null,
  includeCatalog: boolean,
): Promise<z.infer<typeof managerAnalysisSchema>> {
  if (!isDeepSeekConfigured()) return draft;

  const systemInstruction = `Você é DeepSeek V4 no papel de gerenciador completo de saúde do paciente (Louzada Entregas).
Refine o rascunho do Gemini: conecte sintomas/histórico${includeCatalog ? " às especialidades da vitrine" : ""}.
Regras:
- suggestedProfileIds SOMENTE da lista fornecida (ou [] se vitrine omitida).
- Não invente exames/diagnósticos.
- Melhore conclusions e matchRationale em português claro.
- Responda APENAS JSON com as mesmas chaves do rascunho.`;

  const userPrompt = `MEMÓRIA:
${memory.slice(0, 8_000)}

VITRINE:
${includeCatalog ? catalogBlock(catalog) : "(omitida)"}

EVENTO:
${userQuestion?.trim() || "(atualização de memória)"}

RASCUNHO GEMINI:
${JSON.stringify(draft)}`;

  try {
    const detailed = await generateTextWithDeepSeekDetailed({
      systemInstruction,
      userPrompt,
      temperature: 0.2,
      maxTokens: 2048,
      jsonMode: true,
      timeoutMs: 90_000,
    });
    logAiUsage({
      service: "b2c_manager",
      model: detailed.model,
      surface: "patient",
      inputTokens: detailed.usage.promptTokens,
      outputTokens: detailed.usage.completionTokens,
      totalTokens: detailed.usage.totalTokens,
      meta: { phase: "deepseek-refine", includeCatalog },
    });
    const parsed = managerAnalysisSchema.safeParse(
      JSON.parse(stripJsonFences(detailed.text)),
    );
    return parsed.success ? parsed.data : draft;
  } catch (error) {
    logger.warn("health-manager: DeepSeek refine falhou — mantém Flash", {
      feature: "b2c-health-manager",
      error: error instanceof Error ? error.message : String(error),
    });
    return draft;
  }
}

/**
 * Gerenciador completo de saúde B2C:
 * memória compacta + Gemini Flash + DeepSeek condicional + match na vitrine sob demanda.
 */
export async function runPatientHealthManager(input: {
  healthProfileId: string;
  userQuestion?: string | null;
  persistPanorama?: boolean;
  /** Default: true se não há pergunta (pós-intake); no chat passe false em R0/perguntas sem profissional. */
  includeCatalog?: boolean;
}): Promise<HealthManagerResult> {
  const empty: HealthManagerResult = {
    symptoms: [],
    specialtyHints: [],
    urgency: "routine",
    conclusions: [],
    panoramaUpdate: null,
    matchRationale: null,
    professionals: [],
    engine: "none",
  };

  const includeCatalog =
    input.includeCatalog ??
    (input.userQuestion == null || !input.userQuestion.trim());

  try {
    const memoryPack = await buildMemoryPack(input.healthProfileId, {
      maxSummaries: includeCatalog ? 5 : 3,
      maxTasks: 8,
    });
    const latestSummary = await prisma.clinicalSummary.findFirst({
      where: { healthProfileId: input.healthProfileId },
      orderBy: { createdAt: "desc" },
      select: { structured: true },
    });
    const panoramaRejected = readPanoramaReview(latestSummary?.structured).rejected;
    const memory = panoramaRejected.length
      ? `${memoryPack}\n\nItens REMOVIDOS pelo paciente do panorama — nunca reintroduza, nem reescritos: ${JSON.stringify(panoramaRejected)}`
      : memoryPack;

    const catalog = includeCatalog
      ? await getMarketplaceShowcaseProfessionals({ audience: "patient" })
      : [];

    const draft = await runGeminiFlashAnalysis(
      memory,
      catalog,
      input.userQuestion ?? null,
      includeCatalog,
    );
    if (!draft) return empty;

    const useDeepSeek = shouldRefineManagerWithDeepSeek(draft, includeCatalog);
    const refined = useDeepSeek
      ? await refineWithDeepSeek(
          memory,
          catalog,
          draft,
          input.userQuestion ?? null,
          includeCatalog,
        )
      : draft;

    if (!includeCatalog) {
      refined.suggestedProfileIds = [];
    }

    const allowedIds = new Set(catalog.map((p) => showcaseListingId(p)));
    const suggestedIds = refined.suggestedProfileIds.filter((id) =>
      allowedIds.has(id),
    );

    const professionals = includeCatalog
      ? matchProfessionals(
          catalog,
          suggestedIds,
          cleanList(refined.specialtyHints, 8),
          refined.matchRationale
            ? sanitizeText(refined.matchRationale).slice(0, 800)
            : null,
        )
      : [];

    const panoramaUpdateRaw = refined.panoramaUpdate
      ? sanitizeText(refined.panoramaUpdate).slice(0, 2000)
      : null;
    const panoramaUpdate = panoramaUpdateRaw
      ? applyPanoramaRejection(panoramaUpdateRaw, panoramaRejected) || null
      : null;

    if (input.persistPanorama && panoramaUpdate) {
      const previous = await prisma.healthProfile.findUnique({
        where: { id: input.healthProfileId },
        select: { healthPanorama: true },
      });
      const merged = [panoramaUpdate, previous?.healthPanorama?.trim() || null]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 6_000);
      await prisma.healthProfile.update({
        where: { id: input.healthProfileId },
        data: { healthPanorama: merged },
      });
    }

    return {
      symptoms: cleanList(refined.symptoms, 12),
      specialtyHints: cleanList(refined.specialtyHints, 8),
      urgency: refined.urgency,
      conclusions: cleanList(refined.conclusions, 8),
      panoramaUpdate,
      matchRationale: refined.matchRationale
        ? sanitizeText(refined.matchRationale).slice(0, 800)
        : null,
      professionals,
      engine: useDeepSeek ? "gemini-flash+deepseek" : "gemini-flash",
    };
  } catch (error) {
    logger.error("health-manager: falha geral", {
      feature: "b2c-health-manager",
      error: error instanceof Error ? error.message : String(error),
    });
    return empty;
  }
}

export function formatManagerBlockForPrompt(
  manager: HealthManagerResult,
): string {
  if (manager.engine === "none") {
    return "(Gerenciador indisponível nesta rodada.)";
  }
  const proLines =
    manager.professionals.length === 0
      ? "(Sem match na vitrine nesta rodada.)"
      : manager.professionals
          .map(
            (pro, i) =>
              `${i + 1}. ${pro.name}${pro.specialty ? ` · ${pro.specialty}` : ""}${pro.nextSlotAt ? ` · próximo ${new Date(pro.nextSlotAt).toLocaleString("pt-BR")}` : ""} — ${pro.reason}`,
          )
          .join("\n");

  return `Motor: ${manager.engine}
Urgência: ${manager.urgency}
Sintomas detectados: ${manager.symptoms.join("; ") || "n/d"}
Especialidades sugeridas: ${manager.specialtyHints.join("; ") || "n/d"}
Conclusões:
${manager.conclusions.map((c, i) => `${i + 1}. ${c}`).join("\n") || "(nenhuma)"}
Profissionais da vitrine:
${proLines}`;
}
