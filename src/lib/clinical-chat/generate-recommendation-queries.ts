import { z } from "zod";
import { getGeminiFastModel, generateContentSafe } from "@/lib/gemini";
import type { ClinicalProfileSnapshot } from "@/lib/clinical-chat/clinical-profile-snapshot";
import type { RecentChatSignalsSnapshot } from "@/lib/clinical-chat/recent-chat-signals";
import { RECOMMENDATIONS_MAX_QUERIES } from "@/lib/clinical-chat/constants";
import { buildFallbackQueriesFromProfileTags } from "@/lib/clinical-chat/match-recommendation-topic";

const outputSchema = z.object({
  searchQueries: z.array(z.string().min(8).max(200)).max(RECOMMENDATIONS_MAX_QUERIES),
  rationale: z.string().max(500).optional(),
});

export type GenerateRecommendationQueriesResult = z.infer<typeof outputSchema>;

function stripJsonFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function buildProfileBlock(profile: ClinicalProfileSnapshot): string {
  if (profile.topTags.length === 0) {
    return "(Sem perfil clínico agregado ainda — use só os temas das conversas recentes.)";
  }
  return profile.topTags
    .map((t) => `- ${t.tag} (${t.count} atendimentos)`)
    .join("\n");
}

function buildChatBlock(chats: RecentChatSignalsSnapshot): string {
  if (chats.signals.length === 0) {
    return "(Sem conversas recentes na Ester.)";
  }
  return chats.signals
    .map((s, i) => `${i + 1}. ${s.snippet}`)
    .join("\n");
}

/**
 * Gera queries acadêmicas em inglês a partir do perfil clínico + últimas conversas.
 * @param options.prioritizeProfile — modo cron diário: Perfil Clínico é a fonte principal.
 */
export async function generateRecommendationQueries(
  profile: ClinicalProfileSnapshot,
  chats: RecentChatSignalsSnapshot,
  options?: { prioritizeProfile?: boolean },
): Promise<GenerateRecommendationQueriesResult> {
  const hasProfile = profile.topTags.length > 0;
  const hasChats = chats.signals.length > 0;
  const prioritizeProfile = options?.prioritizeProfile === true;

  if (!hasProfile && !hasChats) {
    return { searchQueries: [] };
  }

  if (prioritizeProfile && !hasProfile) {
    return { searchQueries: [] };
  }

  const tagList = profile.topTags.map((t) => t.tag).join(", ");

  const systemInstruction = prioritizeProfile
    ? `Você sugere buscas de literatura médica recente para um profissional de saúde.
Regras:
1. A FONTE PRINCIPAL é o perfil clínico (ramos guarda-chuva / áreas mais atendidas): ${tagList || "(vazio)"}.
2. Cada searchQuery DEVE traduzir UMA área do perfil para INGLÊS acadêmico (ex.: Tendinopatia→tendinopathy; Lombalgia→low back pain; Sindrome Miofascial→myofascial pain).
3. Conversas recentes na Ester, se houver, são contexto secundário — não desvie do perfil.
4. Priorize guidelines, systematic reviews e ensaios recentes.
5. SEM nomes próprios, CPF, telefone ou qualquer dado identificável.
6. Máximo ${RECOMMENDATIONS_MAX_QUERIES} queries distintas (preferir 1 por área do top perfil).
7. PROIBIDO queries genéricas ("clinical medicine", "healthcare review", "patient care").
8. Responda APENAS JSON: {"searchQueries":string[],"rationale":string}`
    : `Você sugere buscas de literatura médica recente para um profissional de saúde.
Regras:
1. Combine o perfil clínico (diagnósticos/áreas mais atendidas) com temas das conversas recentes na Ester.
2. Se houver tags de perfil (${tagList || "nenhuma"}), cada query deve refletir pelo menos uma delas em inglês acadêmico.
3. Priorize diretrizes, revisões e ensaios dos últimos anos quando fizer sentido.
4. searchQueries: em INGLÊS acadêmico, SEM nomes próprios, CPF, telefone ou qualquer dado identificável.
5. Máximo ${RECOMMENDATIONS_MAX_QUERIES} queries distintas e específicas.
6. Evite queries genéricas ("clinical medicine review").
7. Responda APENAS JSON: {"searchQueries":string[],"rationale":string}`;

  const userBlock = `Perfil clínico (tags mais frequentes):
${buildProfileBlock(profile)}

Perguntas recentes na Ester (anonimizadas):
${buildChatBlock(chats)}`;

  const model = getGeminiFastModel({
    systemInstruction,
    generationConfig: { temperature: 0.2 },
  });

  const result = await generateContentSafe(model, userBlock, 30_000, 1);
  const raw = result.response.text();

  let json: unknown;
  try {
    json = JSON.parse(stripJsonFences(typeof raw === "string" ? raw : ""));
  } catch {
    if (hasProfile) {
      return {
        searchQueries: buildFallbackQueriesFromProfileTags(
          profile.topTags.map((t) => t.tag),
          RECOMMENDATIONS_MAX_QUERIES,
        ),
        rationale: "Queries geradas a partir do Perfil Clínico (fallback).",
      };
    }
    return { searchQueries: [] };
  }

  const parsed = outputSchema.safeParse(json);
  if (!parsed.success) {
    if (hasProfile) {
      return {
        searchQueries: buildFallbackQueriesFromProfileTags(
          profile.topTags.map((t) => t.tag),
          RECOMMENDATIONS_MAX_QUERIES,
        ),
        rationale: "Queries geradas a partir do Perfil Clínico (fallback).",
      };
    }
    return { searchQueries: [] };
  }

  let searchQueries = parsed.data.searchQueries
    .map((q) => q.trim())
    .filter((q) => q.length >= 8)
    .filter((q) => !isGenericQuery(q))
    .slice(0, RECOMMENDATIONS_MAX_QUERIES);

  if (hasProfile) {
    searchQueries = ensureProfileTagCoverage(
      searchQueries,
      profile.topTags.map((t) => t.tag),
      RECOMMENDATIONS_MAX_QUERIES,
    );
  }

  if (searchQueries.length === 0 && hasProfile) {
    searchQueries = buildFallbackQueriesFromProfileTags(
      profile.topTags.map((t) => t.tag),
      RECOMMENDATIONS_MAX_QUERIES,
    );
  }

  return {
    searchQueries,
    rationale: parsed.data.rationale,
  };
}

function isGenericQuery(query: string): boolean {
  const q = query.toLowerCase();
  const banned = [
    "clinical medicine",
    "healthcare review",
    "patient care overview",
    "general medicine",
    "medical practice review",
  ];
  return banned.some((b) => q.includes(b));
}

/** Garante pelo menos uma query cobrindo cada tag do top (até max), via fallback EN. */
function ensureProfileTagCoverage(
  queries: string[],
  tags: string[],
  maxQueries: number,
): string[] {
  const out = [...queries];
  const joined = out.join(" ").toLowerCase();

  for (const tag of tags) {
    if (out.length >= maxQueries) break;
    const fallback = buildFallbackQueriesFromProfileTags([tag], 1)[0];
    if (!fallback) continue;
    // Heurística: se nenhum token EN da tag aparece nas queries, acrescenta.
    const probe = fallback.split(" ").slice(0, 2).join(" ").toLowerCase();
    if (probe && !joined.includes(probe.split(" ")[0]!)) {
      out.push(fallback);
    }
  }

  return out.slice(0, maxQueries);
}
