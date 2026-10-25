import { z } from "zod";

import {
  GEMINI_FAST_MODEL,
  generateContentSafeWithModelFallback,
  isGeminiConfigured,
} from "@/lib/gemini";
import type { LogisticsTaskDraft } from "@/lib/logistics/intake-schema";
import { hearLogisticsMoney } from "@/lib/logistics/money";
import { formatTemporalAnchor, resolveLogisticsDate, resolveLogisticsTime, temporalAnchor } from "@/lib/logistics/temporal-resolve";

const modelTaskSchema = z.object({
  type: z.enum(["ENTREGA", "COLETA"]),
  clientName: z.string().nullable(),
  workDescription: z.string().nullable(),
  dateExpression: z.string().nullable(),
  timeWindowStartExpression: z.string().nullable(),
  timeWindowEndExpression: z.string().nullable(),
  amountExpression: z.string().nullable().optional(),
  paymentMethod: z.string().nullable().optional(),
});

const modelIntakeSchema = z.object({
  tasks: z.array(modelTaskSchema).min(1).max(30),
});

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced?.[1] ?? text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * A LLM devolve as expressões ouvidas. O servidor converte para data e hora
 * com o relógio do momento do comando, em America/Sao_Paulo.
 */
export async function extractLogisticsTasksWithModel(
  transcript: string,
  now: Date,
): Promise<LogisticsTaskDraft[] | null> {
  if (!isGeminiConfigured() || !transcript.trim()) return null;
  const anchor = temporalAnchor(now);
  const prompt = `${formatTemporalAnchor(anchor)}

Transcrição:
"""
${transcript.trim()}
"""

Extraia um array de ordens. Uma frase pode ter várias. Não invente dentista, data, hora, valor ou forma de pagamento.
Se o nome não foi dito, clientName = null.
dateExpression é a expressão ouvida ("hoje", "amanhã", "semana que vem", "próxima terça") ou YYYY-MM-DD.
timeWindowEndExpression é o horário limite ("cinco horas da tarde", "18:00"). timeWindowStartExpression só se houver início de janela.
coleta/coletar = COLETA. entrega/entregar = ENTREGA.
amountExpression é o valor ouvido ("800 reais", "R$ 1.250,50") ou null. Horário não é valor.
paymentMethod é a forma ouvida (pix, dinheiro, cartão, transferência) ou null.

Responda só JSON:
{"tasks":[{"type":"COLETA","clientName":"Marcelo","workDescription":null,"dateExpression":"hoje","timeWindowStartExpression":null,"timeWindowEndExpression":"cinco horas da tarde","amountExpression":null,"paymentMethod":null}]}`;

  try {
    const { result } = await generateContentSafeWithModelFallback(
      { generationConfig: { temperature: 0 } },
      prompt,
      45_000,
      [GEMINI_FAST_MODEL],
    );
    const parsed = modelIntakeSchema.safeParse(extractJson(result.response.text() ?? ""));
    if (!parsed.success) return null;
    return parsed.data.tasks.map((task) => {
      const money = hearLogisticsMoney(
        [task.amountExpression, task.paymentMethod].filter(Boolean).join(" "),
      );
      return {
        type: task.type,
        clientName: task.clientName?.trim() || null,
        courierName: null,
        workDescription: task.workDescription?.trim() || null,
        targetDate: resolveLogisticsDate(task.dateExpression, now),
        timeWindowStart: resolveLogisticsTime(task.timeWindowStartExpression),
        timeWindowEnd: resolveLogisticsTime(task.timeWindowEndExpression),
        amountCents: money.amountCents,
        paymentMethod: money.paymentMethod,
      } satisfies LogisticsTaskDraft;
    });
  } catch {
    return null;
  }
}
