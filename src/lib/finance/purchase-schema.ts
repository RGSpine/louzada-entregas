import { z } from "zod";

/**
 * Schema de criação de venda/pacote (Consultório Financeiro).
 * Inclui gates P2 em `superRefine` (consumeFirstSessionAt exige vínculo).
 */
export const createPurchaseSchema = z
  .object({
    patientId: z.string().min(1),
    professionalServiceId: z.string().min(1),
    type: z.enum(["SINGLE", "PACKAGE"]),
    billingMode: z.enum(["SESSION", "MONTHLY"]).optional(),
    agreedPriceCents: z.coerce.number().int().min(0).max(500_000_000),
    /**
     * Valor efetivamente recebido no caixa (ex.: catálogo + juros no crédito).
     * Se omitido, usa agreedPriceCents. A compra / rateio de sessões permanece no valor acordado.
     */
    paymentAmountCents: z.coerce.number().int().min(1).max(500_000_000).optional(),
    sessionCountTotal: z.coerce.number().int().optional(),
    notes: z.string().max(4000).optional(),
    registerIncomePayment: z.boolean().optional(),
    paymentMethod: z.enum(["PIX", "CASH", "CARD", "TRANSFER", "OTHER"]).optional(),
    paymentOccurredAt: z.coerce.date().optional(),
    paymentDescription: z.string().max(500).optional(),
    idempotencyKey: z.string().trim().min(8).max(200).optional(),
    originAppointmentId: z.string().trim().min(1).optional(),
    /**
     * Quando a evolução afirma que esta consulta é sessão do plano,
     * baixa a 1ª sessão pendente na data do atendimento.
     */
    consumeFirstSessionAt: z.coerce.date().optional(),
    /**
     * Sessões históricas já realizadas (áudio/ficha Serviços-Fiscal).
     * Consome as primeiras N sessões PENDING na ordem dada, com `consumedAt` em cada uma.
     * Não exige evolutionId/originAppointmentId (baixa MANUAL).
     */
    preConsumedSessions: z
      .array(
        z.object({
          consumedAt: z.coerce.date(),
        }),
      )
      .max(200)
      .optional(),
    /** Liga o consumo à evolução (idempotente via SessionConsumptionEvent.evolutionId). */
    evolutionId: z.string().trim().min(1).optional(),
    serviceSpaceId: z.string().trim().min(1).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.billingMode === "MONTHLY" && data.type === "PACKAGE") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Mensalidade não usa pacote de N sessões — use consulta única / período mensal.",
        path: ["type"],
      });
    }
    if (data.type === "SINGLE" && data.sessionCountTotal !== undefined && data.sessionCountTotal !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Consulta única usa 1 sessão.",
      });
    }
    if (
      data.type === "PACKAGE" &&
      (!data.sessionCountTotal || data.sessionCountTotal < 2)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Pacote precisa de ao menos 2 sessões.",
      });
    }
    if (data.registerIncomePayment === true && data.agreedPriceCents < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe um valor maior que zero para registrar o pagamento no caixa.",
        path: ["agreedPriceCents"],
      });
    }
    if (
      data.paymentAmountCents != null &&
      data.paymentAmountCents < data.agreedPriceCents
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "O valor recebido não pode ser menor que o valor acordado da compra.",
        path: ["paymentAmountCents"],
      });
    }
    if (
      data.consumeFirstSessionAt &&
      data.consumeFirstSessionAt.getTime() > Date.now() + 24 * 60 * 60 * 1000
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A data da sessão realizada não pode estar no futuro.",
        path: ["consumeFirstSessionAt"],
      });
    }
    // Baixa de 1ª sessão exige vínculo explícito (evolução ou marcação) — evita P2 bypass.
    if (data.consumeFirstSessionAt && !data.evolutionId && !data.originAppointmentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Para baixar a 1ª sessão, informe a evolução (evolutionId) ou a marcação de origem.",
        path: ["consumeFirstSessionAt"],
      });
    }
    if (data.preConsumedSessions && data.preConsumedSessions.length > 0) {
      const total =
        data.type === "SINGLE" ? 1 : (data.sessionCountTotal ?? 0);
      if (data.preConsumedSessions.length > total) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Há mais sessões realizadas do que o total do pacote.",
          path: ["preConsumedSessions"],
        });
      }
      const futureLimit = Date.now() + 24 * 60 * 60 * 1000;
      for (let i = 0; i < data.preConsumedSessions.length; i++) {
        const at = data.preConsumedSessions[i]?.consumedAt;
        if (at && at.getTime() > futureLimit) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "A data de uma sessão realizada não pode estar no futuro.",
            path: ["preConsumedSessions", i, "consumedAt"],
          });
        }
      }
      if (data.consumeFirstSessionAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Use preConsumedSessions ou consumeFirstSessionAt, não ambos.",
          path: ["preConsumedSessions"],
        });
      }
    }
  });

export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;

/** Mensagens estáveis das guardas P2 (espelham purchase-guards / clinic-finances). */
export const P2_GATE_MESSAGES = {
  evolutionAgendaOwned:
    "Esta evolução veio da Agenda. O serviço, a receita e a baixa de sessão são tratados pela marcação vinculada — não é permitido criar outra venda aqui.",
  dayAgendaOwned:
    "Há evolução de hoje vinculada à Agenda. O serviço e a receita ficam com a marcação — não crie venda paralela.",
  appointmentHasPurchase: "Já existe uma venda vinculada a esta marcação. Não crie outra.",
  appointmentHasIncome:
    "Esta marcação já tem entrada no caixa. Não registre outra venda para o mesmo atendimento.",
  appointmentHasSession:
    "Esta marcação já está vinculada a uma sessão de pacote. Não crie outra venda aqui.",
  consumeRequiresLink:
    "Para baixar a 1ª sessão, informe a evolução (evolutionId) ou a marcação de origem.",
} as const;

/**
 * Predicado puro: evolução com appointmentId não pode abrir venda standalone.
 */
export function evolutionBlocksStandalonePurchase(evo: {
  appointmentId: string | null;
} | null): boolean {
  return Boolean(evo?.appointmentId);
}

/**
 * Predicado puro: marcação já “dona” do financeiro bloqueia nova venda
 * (exceto replay idempotente — tratado pelo caller).
 */
export function originAppointmentBlocksNewPurchase(appt: {
  patientServiceSessionId: string | null;
  originatedPurchase: { id: string; idempotencyKey: string | null } | null;
  financialTransaction: { id: string; kind: string; voidedAt?: Date | null } | null;
} | null, idempotencyKey?: string): { blocked: boolean; reason?: string } {
  if (!appt) {
    return { blocked: true, reason: "A marcação de origem não pertence ao paciente selecionado." };
  }
  const existing = appt.originatedPurchase;
  if (existing) {
    if (
      idempotencyKey &&
      existing.idempotencyKey &&
      existing.idempotencyKey === idempotencyKey
    ) {
      return { blocked: false };
    }
    return { blocked: true, reason: P2_GATE_MESSAGES.appointmentHasPurchase };
  }
  const activeIncome =
    appt.financialTransaction &&
    appt.financialTransaction.kind === "INCOME" &&
    !appt.financialTransaction.voidedAt;
  if (activeIncome) {
    return { blocked: true, reason: P2_GATE_MESSAGES.appointmentHasIncome };
  }
  if (appt.patientServiceSessionId) {
    return { blocked: true, reason: P2_GATE_MESSAGES.appointmentHasSession };
  }
  return { blocked: false };
}
