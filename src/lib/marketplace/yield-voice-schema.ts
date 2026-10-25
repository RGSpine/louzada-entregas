import { z } from "zod";

/** Ações de voz da Gestão Inteligente (paridade com botões da UI). */
export const yieldVoiceActionSchema = z.enum([
  "enable",
  "disable",
  "set_rule",
  "offer",
  "withdraw",
  "save_window",
  "delete_window",
  "none",
  "ambiguous",
]);

export type YieldVoiceAction = z.infer<typeof yieldVoiceActionSchema>;

const weekdaySchema = z.coerce.number().int().min(1).max(7);

export const yieldVoiceCommandSchema = z.object({
  itemAction: yieldVoiceActionSchema.nullable().optional(),
  /** Data pt-BR: hoje, amanhã, terça, 30/09, próximas 4 terças… */
  dateExpression: z.string().max(200).nullable().optional(),
  timeExpression: z.string().max(64).nullable().optional(),
  /** Faixa de janela: "14h" / "14:00". */
  startTimeExpression: z.string().max(64).nullable().optional(),
  endTimeExpression: z.string().max(64).nullable().optional(),
  discountPercentage: z.number().int().min(1).max(90).nullable().optional(),
  hoursBeforeTrigger: z.number().int().min(1).max(168).nullable().optional(),
  /** Série: quantas ocorrências (ex.: próximas 4 terças). */
  repetitions: z.number().int().min(1).max(16).nullable().optional(),
  weekdays: z.array(weekdaySchema).max(7).nullable().optional(),
  recurrence: z.enum(["WEEKLY", "ONCE"]).nullable().optional(),
  specificDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  label: z.string().max(80).nullable().optional(),
  /** Alias falado: "30% de desconto" → discountPercentage. */
  discountYield: z.number().int().min(1).max(90).nullable().optional(),
});

export type YieldVoiceCommand = z.infer<typeof yieldVoiceCommandSchema>;

export const yieldVoiceModelOutputSchema = z.object({
  action: yieldVoiceActionSchema.default("ambiguous"),
  commands: z.array(yieldVoiceCommandSchema).max(16).default([]),
  transcriptOrSummary: z.string().max(2000).nullable().optional(),
  confidenceOverall: z.number().min(0).max(1).default(0),
});

export type YieldVoiceModelOutput = z.infer<typeof yieldVoiceModelOutputSchema>;

export function normalizeYieldDiscount(
  item: Pick<YieldVoiceCommand, "discountPercentage" | "discountYield">,
): number | null {
  const value = item.discountPercentage ?? item.discountYield ?? null;
  if (value == null || !Number.isFinite(value)) return null;
  return Math.min(90, Math.max(1, Math.round(value)));
}
