import { z } from "zod";

export const appointmentVisitKindSchema = z.enum([
  "UNIQUE_CONSULTATION",
  "RETURN",
  "TREATMENT_PLAN",
]);

export const appointmentCareSettingSchema = z.enum([
  "IN_PERSON_CLINIC",
  "ONLINE",
  "HOME_VISIT",
]);

export const appointmentPriceCentsSchema = z
  .number()
  .int()
  .min(0)
  .max(100_000_000)
  .nullable()
  .optional();

export const appointmentNotesSchema = z.string().max(2000).nullable().optional();

export const appointmentConfirmationStatusSchema = z.enum([
  "PENDING_CONFIRMATION",
  "CONFIRMED",
]);

export const appointmentMetaFieldsSchema = z.object({
  visitKind: appointmentVisitKindSchema.optional(),
  careSetting: appointmentCareSettingSchema.optional(),
  priceCents: appointmentPriceCentsSchema,
  notes: appointmentNotesSchema,
  patientServiceSessionId: z.string().min(1).nullable().optional(),
  professionalServiceId: z.string().min(1).nullable().optional(),
  serviceSpaceId: z.string().min(1).nullable().optional(),
});

export type AppointmentVisitKindValue = z.infer<typeof appointmentVisitKindSchema>;
export type AppointmentCareSettingValue = z.infer<typeof appointmentCareSettingSchema>;
export type AppointmentConfirmationStatusValue = z.infer<typeof appointmentConfirmationStatusSchema>;
