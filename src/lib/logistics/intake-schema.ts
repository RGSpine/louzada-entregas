import { z } from "zod";

/** Dia alvo citado no áudio, calendário America/Sao_Paulo. */
const targetDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, "Data alvo inválida.")
  .nullable();

/** Horário HH:mm citado no áudio. */
const timeWindowSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido.")
  .nullable();

const paymentMethodSchema = z.enum(["CASH", "PIX", "CARD", "TRANSFER", "OTHER"]).nullable();

/** Uma ordem ouvida no áudio, antes do fuzzy match. */
export const logisticsTaskDraftSchema = z
  .object({
    type: z.enum(["ENTREGA", "COLETA"]),
    clientName: z.string().trim().min(1).max(200).nullable(),
    courierName: z.string().trim().min(1).max(80).nullable().default(null),
    workDescription: z.string().trim().max(2000).nullable(),
    targetDate: targetDateSchema,
    timeWindowStart: timeWindowSchema,
    timeWindowEnd: timeWindowSchema,
    /** Centavos citados no áudio, ou o preço do catálogo quando a prótese foi nomeada. */
    amountCents: z.number().int().nonnegative().max(100_000_000).nullable().default(null),
    /** Forma de pagamento citada. O valor entra no Financeiro; a agenda não guarda o caixa. */
    paymentMethod: paymentMethodSchema.default(null),
  })
  .refine(
    (task) =>
      task.timeWindowStart == null ||
      task.timeWindowEnd == null ||
      task.timeWindowStart <= task.timeWindowEnd,
    { message: "O início da janela precisa ser anterior ou igual ao horário limite.", path: ["timeWindowStart"] },
  );

/**
 * Saída obrigatória da IA depois da transcrição.
 * Um áudio da Suzana ou da Ellen vira este array. Fora do schema, o lote é rejeitado.
 */
export const logisticsIntakeSchema = z.object({
  tasks: z.array(logisticsTaskDraftSchema).min(1).max(30),
});

export type LogisticsTaskDraft = z.infer<typeof logisticsTaskDraftSchema>;
export type LogisticsIntakeDraft = z.infer<typeof logisticsIntakeSchema>;

export function parseLogisticsIntake(
  input: unknown,
): { ok: true; data: LogisticsIntakeDraft } | { ok: false; error: string } {
  const parsed = logisticsIntakeSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return { ok: false, error: `${path}${issue?.message ?? "Lote de tarefas inválido."}` };
  }
  return { ok: true, data: parsed.data };
}
