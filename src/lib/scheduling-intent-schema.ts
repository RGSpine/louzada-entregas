import { z } from "zod";
import {
  appointmentCareSettingSchema,
  appointmentConfirmationStatusSchema,
  appointmentNotesSchema,
  appointmentPriceCentsSchema,
  appointmentVisitKindSchema,
} from "@/lib/appointment-fields-schema";

/** Operação pedida por item. Ausente → herda a ação global do áudio/imagem. */
export const schedulingItemActionSchema = z
  .enum(["create", "book", "reschedule", "cancel", "rename", "yield", "no_show"])
  .transform((value) => (value === "book" ? "create" : value));

export const schedulingIntentItemSchema = z.object({
  itemAction: schedulingItemActionSchema.nullable().optional(),
  patientNameGuess: z.string().max(200).nullable().optional(),
  /** Data da marcação existente (remarcar/desmarcar/falta) ou da nova marcação (criar). */
  dateExpression: z.string().max(200).nullable().optional(),
  /** Hora da marcação existente (remarcar/desmarcar/falta) ou da nova marcação (criar). */
  timeExpression: z.string().max(64).nullable().optional(),
  /** Só remarcar: data de destino. */
  newDateExpression: z.string().max(200).nullable().optional(),
  /** Só remarcar: hora de destino. */
  newTimeExpression: z.string().max(64).nullable().optional(),
  /** Só renomear: novo nome exibido na agenda (ex.: FECHADO → Eric). */
  newPatientNameGuess: z.string().max(200).nullable().optional(),
  /**
   * Só falta (no_show): causa relatada (mín. 3 caracteres no servidor).
   * Ex.: "imprevisto familiar", "atraso no transporte".
   */
  noShowReason: z.string().max(2000).nullable().optional(),
  durationMinutes: z.number().int().min(15).max(480).nullable().optional(),
  title: z.string().max(500).nullable().optional(),
  visitKind: appointmentVisitKindSchema.nullable().optional(),
  careSetting: appointmentCareSettingSchema.nullable().optional(),
  priceCents: appointmentPriceCentsSchema,
  notes: appointmentNotesSchema,
  serviceNameGuess: z.string().max(200).nullable().optional(),
  confirmationStatus: appointmentConfirmationStatusSchema.nullable().optional(),
  /** Sala/recurso dito no áudio (ex.: "sala de Pilates"). */
  resourceNameGuess: z.string().max(200).nullable().optional(),
  /** Desconto de ociosidade pedido (1–90). Null se não falou em yield. */
  discountYield: z.number().int().min(1).max(90).nullable().optional(),
});

export const schedulingModelOutputSchema = z.object({
  action: z
    .enum([
      "create",
      "book",
      "reschedule",
      "cancel",
      "rename",
      "yield",
      "no_show",
      "none",
      "ambiguous",
    ])
    .transform((value) => (value === "book" ? "create" : value))
    .default("ambiguous"),
  /** Até 16: cobre "próximas 8 segundas" + outros slots no mesmo áudio. */
  appointments: z.array(schedulingIntentItemSchema).max(16).default([]),
  transcriptOrSummary: z.string().max(2000).nullable().optional(),
  confidenceOverall: z.number().min(0).max(1).default(0),
});

export type SchedulingModelOutput = z.infer<typeof schedulingModelOutputSchema>;
export type SchedulingIntentItem = z.infer<typeof schedulingIntentItemSchema>;
export type SchedulingItemAction = z.infer<typeof schedulingItemActionSchema>;
