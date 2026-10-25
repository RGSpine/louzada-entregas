import { z } from "zod";

export const yieldConfigSchema = z.object({
  enabled: z.boolean(),
  hoursBeforeTrigger: z.coerce
    .number({ error: "Informe as horas." })
    .int("Use horas inteiras.")
    .min(1, "Mínimo: 1 hora.")
    .max(168, "Máximo: 168 horas (7 dias)."),
  discountPercentage: z.coerce
    .number({ error: "Informe o desconto." })
    .min(1, "Desconto mínimo: 1%.")
    .max(90, "Desconto máximo: 90%."),
});

export type YieldConfigInput = z.infer<typeof yieldConfigSchema>;

export type YieldConfigData = {
  enabled: boolean;
  hoursBeforeTrigger: number;
  discountPercentage: number;
  ruleId: string | null;
};

export const DEFAULT_YIELD_CONFIG: YieldConfigData = {
  enabled: false,
  hoursBeforeTrigger: 24,
  discountPercentage: 30,
  ruleId: null,
};

const weekdaySchema = z.coerce.number().int().min(1).max(7);

export const yieldOfferWindowSchema = z
  .object({
    id: z.string().min(1).optional(),
    label: z.string().trim().max(80).nullable().optional(),
    recurrence: z.enum(["WEEKLY", "ONCE"]),
    weekdays: z.array(weekdaySchema).max(7).default([]),
    startMinute: z.coerce
      .number()
      .int()
      .min(0, "Horário inicial inválido.")
      .max(23 * 60 + 59),
    endMinute: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 60, "Horário final inválido."),
    specificDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (use aaaa-mm-dd).")
      .nullable()
      .optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.endMinute - value.startMinute < 60) {
      ctx.addIssue({
        code: "custom",
        message: "A faixa precisa ter pelo menos 1 hora.",
        path: ["endMinute"],
      });
    }
    if (value.recurrence === "WEEKLY" && value.weekdays.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Selecione ao menos um dia da semana.",
        path: ["weekdays"],
      });
    }
    if (value.recurrence === "ONCE" && !value.specificDate) {
      ctx.addIssue({
        code: "custom",
        message: "Informe a data pontual.",
        path: ["specificDate"],
      });
    }
  });

export type YieldOfferWindowInput = z.infer<typeof yieldOfferWindowSchema>;

export type YieldOfferWindowData = {
  id: string;
  label: string | null;
  recurrence: "WEEKLY" | "ONCE";
  weekdays: number[];
  startMinute: number;
  endMinute: number;
  specificDate: string | null;
  isActive: boolean;
};

export type YieldMarketplaceSlotRow = {
  id: string;
  startAt: string;
  endAt: string;
  status: "AVAILABLE" | "BOOKED" | "BLOCKED";
  yieldActive: boolean;
  manualOffer: boolean;
  basePrice: number;
  discountPrice: number | null;
  patientName: string | null;
};

export type YieldDashboardData = {
  config: YieldConfigData;
  windows: YieldOfferWindowData[];
  slots: YieldMarketplaceSlotRow[];
};

export const WEEKDAY_OPTIONS = [
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
  { value: 7, label: "Dom" },
] as const;

export function formatWeekdaysLabel(weekdays: number[]): string {
  const set = new Set(weekdays);
  return WEEKDAY_OPTIONS.filter((d) => set.has(d.value))
    .map((d) => d.label)
    .join(", ");
}

export const offerAgendaSlotSchema = z.object({
  startAt: z.coerce.date(),
  endAt: z.coerce.date().optional(),
  discountPercentage: z.coerce.number().min(1).max(90).optional(),
});

export const withdrawAgendaSlotSchema = z.object({
  slotId: z.string().min(1),
});
