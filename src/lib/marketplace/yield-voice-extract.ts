import type { Part } from "@google/generative-ai";
import { generateContentSafeWithModelFallback } from "@/lib/gemini";
import { formatAiProviderErrorForUser } from "@/lib/ai-provider-user-message";
import {
  yieldVoiceModelOutputSchema,
  type YieldVoiceModelOutput,
} from "@/lib/marketplace/yield-voice-schema";
import type { YieldConfigData, YieldOfferWindowData } from "@/lib/marketplace/yield-schema";
import { minutesToTimeLabel } from "@/lib/marketplace/slot-grid";
import { formatWeekdaysLabel } from "@/lib/marketplace/yield-schema";

function stripJsonFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseModelJson(text: string): unknown {
  try {
    return JSON.parse(stripJsonFences(text));
  } catch {
    return null;
  }
}

function buildPrompt(
  config: YieldConfigData,
  windows: YieldOfferWindowData[],
): string {
  const windowList =
    windows.length > 0
      ? windows
          .map((w) => {
            const when =
              w.recurrence === "WEEKLY"
                ? formatWeekdaysLabel(w.weekdays)
                : (w.specificDate ?? "—");
            return `- ${w.label ?? "Janela"} (${w.recurrence}): ${when} ${minutesToTimeLabel(w.startMinute)}–${minutesToTimeLabel(w.endMinute)} [id=${w.id}]`;
          })
          .join("\n")
      : "(nenhuma janela salva)";

  return `
Extrais intenções de GESTÃO INTELIGENTE / YIELD (marketplace de ociosidade) a partir do áudio.
Timezone America/Sao_Paulo. Respondes só JSON.

Estado atual:
- ativo: ${config.enabled ? "sim" : "não"}
- desconto: ${config.discountPercentage}%
- horas antes: ${config.hoursBeforeTrigger}h

Janelas salvas:
${windowList}

## Ações (action / itemAction)

- enable — ativar gestão inteligente
- disable — desativar
- set_rule — mudar % e/ou horas (discountPercentage, hoursBeforeTrigger)
- offer — ofertar horário(s) no marketplace com desconto (opt-in). dateExpression + timeExpression. Opcional: discountYield/discountPercentage, repetitions (série), weekdays
- withdraw — retirar oferta (dateExpression + timeExpression)
- save_window — salvar preferência de faixa (NÃO cria slots sozinha). recurrence WEEKLY|ONCE, weekdays, startTimeExpression, endTimeExpression, specificDate, label
- delete_window — remover janela (label se possível)
- none — conversa sem comando
- ambiguous — falta dado essencial

Regras:
- Ofertar NUNCA inventa horário: exige data + hora ditas.
- "próximas 4 terças às 15h" → action offer, dateExpression "próximas 4 terças", timeExpression "15h", repetitions 4, weekdays [2]
- "30% de desconto" → discountPercentage ou discountYield = 30
- "faltando 24 horas" → hoursBeforeTrigger = 24
- Vários pedidos no mesmo áudio → vários objetos em commands (máx 16)
- action global = operação dominante

Exemplo 1 — "Ativa a gestão com 30% faltando 24 horas"
{
  "action": "enable",
  "commands": [
    { "itemAction": "enable" },
    { "itemAction": "set_rule", "discountPercentage": 30, "hoursBeforeTrigger": 24 }
  ],
  "transcriptOrSummary": "Ativar gestão 30% / 24h.",
  "confidenceOverall": 0.9
}

Exemplo 2 — "Oferece amanhã às 15h com 30% de desconto"
{
  "action": "offer",
  "commands": [
    {
      "itemAction": "offer",
      "dateExpression": "amanhã",
      "timeExpression": "15h",
      "discountYield": 30
    }
  ],
  "transcriptOrSummary": "Ofertar amanhã 15h com 30%.",
  "confidenceOverall": 0.9
}

Exemplo 3 — "Joga as próximas 4 terças às 10h pro marketplace"
{
  "action": "offer",
  "commands": [
    {
      "itemAction": "offer",
      "dateExpression": "próximas 4 terças",
      "timeExpression": "10h",
      "repetitions": 4,
      "weekdays": [2]
    }
  ],
  "transcriptOrSummary": "Ofertar 4 terças às 10h.",
  "confidenceOverall": 0.85
}

Exemplo 4 — "Retira a oferta de quinta às 16h"
{
  "action": "withdraw",
  "commands": [
    { "itemAction": "withdraw", "dateExpression": "quinta", "timeExpression": "16h" }
  ],
  "transcriptOrSummary": "Retirar quinta 16h.",
  "confidenceOverall": 0.9
}

Exemplo 5 — "Cria janela semanal segunda a sexta das 14h às 18h"
{
  "action": "save_window",
  "commands": [
    {
      "itemAction": "save_window",
      "recurrence": "WEEKLY",
      "weekdays": [1, 2, 3, 4, 5],
      "startTimeExpression": "14h",
      "endTimeExpression": "18h",
      "label": "Tarde comercial"
    }
  ],
  "transcriptOrSummary": "Janela seg–sex 14–18h.",
  "confidenceOverall": 0.9
}

JSON EXACTO:
{
  "action": "enable"|"disable"|"set_rule"|"offer"|"withdraw"|"save_window"|"delete_window"|"none"|"ambiguous",
  "commands": [ { ...campos opcionais... } ],
  "transcriptOrSummary": string|null,
  "confidenceOverall": number
}
`.trim();
}

export async function extractYieldVoiceIntent(params: {
  config: YieldConfigData;
  windows: YieldOfferWindowData[];
  audio: { base64: string; mimeType: string };
}): Promise<{ ok: true; data: YieldVoiceModelOutput } | { ok: false; error: string }> {
  const { config, windows, audio } = params;
  if (!audio?.base64) {
    return { ok: false, error: "Envie um áudio de comando." };
  }

  const parts: Part[] = [
    { text: buildPrompt(config, windows) },
    {
      inlineData: { mimeType: audio.mimeType || "audio/webm", data: audio.base64 },
    },
    { text: "(áudio acima — extrai comandos de gestão inteligente / yield)" },
  ];

  try {
    const { result } = await generateContentSafeWithModelFallback(
      {
        systemInstruction: `
És assistente de Gestão Inteligente (marketplace de ociosidade) no Brasil (America/Sao_Paulo).
Respondes apenas JSON válido, sem markdown.
Classificas: enable, disable, set_rule, offer, withdraw, save_window, delete_window, none, ambiguous.
Ofertar horário exige data + hora ditas — nunca inventes.
Ativar NÃO cria horários sozinho; só enable/set_rule.
Séries ("próximas N terças") → offer com repetitions e weekdays.
Percentual 1–90; horas antes 1–168.
`.trim(),
        generationConfig: {
          temperature: 0.12,
          responseMimeType: "application/json",
        },
      },
      parts,
      120_000,
    );

    const text = result.response.text();
    if (!text?.trim()) {
      return { ok: false, error: "Modelo não devolveu conteúdo." };
    }
    const json = parseModelJson(text);
    const parsed = yieldVoiceModelOutputSchema.safeParse(json);
    if (!parsed.success) {
      return { ok: false, error: "Resposta da IA não pôde ser validada." };
    }
    return { ok: true, data: parsed.data };
  } catch (e) {
    return { ok: false, error: formatAiProviderErrorForUser(e) };
  }
}
