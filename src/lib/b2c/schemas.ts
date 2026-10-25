import { z } from "zod";
import { sanitizeText } from "@/lib/sanitize";

export const B2C_HEALTH_CHAT_RATE_LIMIT = {
  maxRequests: 10,
  windowSeconds: 60,
} as const;

export const B2C_HEALTH_INTAKE_RATE_LIMIT = {
  maxRequests: 8,
  windowSeconds: 60,
} as const;

export const B2C_WEARABLE_SYNC_RATE_LIMIT = {
  maxRequests: 20,
  windowSeconds: 60,
} as const;

export const B2C_HEALTH_JOURNAL_RATE_LIMIT = {
  maxRequests: 12,
  windowSeconds: 60,
} as const;

export const MAX_B2C_AUDIO_BYTES = 12 * 1024 * 1024;
export const MAX_B2C_EXAM_BYTES = 8 * 1024 * 1024;
/** Áudio de consulta — mesmo teto Premium/Consultório/Clínica do pro (6 min). */
export const MAX_B2C_AUDIO_SECONDS = 360;
/** Relato falado do paciente — mais longo que a nota curta, distinto da consulta. */
export const MAX_HEALTH_JOURNAL_AUDIO_SECONDS = 600;
export const MAX_HEALTH_JOURNAL_AUDIO_BYTES = 18 * 1024 * 1024;
export const MAX_HEALTH_JOURNAL_CHARS = 12_000;
/** Até N exames/laudos por envio (sozinhos ou junto com o áudio). */
export const MAX_B2C_EXAM_FILES = 3;

export const ALLOWED_B2C_AUDIO_MIME = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/x-m4a",
  "audio/mp3",
]);

export const ALLOWED_B2C_EXAM_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const optionalPhone = z
  .string()
  .trim()
  .max(40)
  .optional()
  .transform((value) => {
    if (!value) return undefined;
    const cleaned = sanitizeText(value).replace(/[^\d+\-\s()]/g, "").slice(0, 40);
    return cleaned || undefined;
  });

export const registerB2cPatientSchema = z.object({
  name: z
    .string({ error: "Informe seu nome." })
    .trim()
    .min(2, "Informe seu nome.")
    .max(200, "Nome muito longo.")
    .transform((value) => sanitizeText(value)),
  email: z
    .string({ error: "Informe um e-mail válido." })
    .trim()
    .email("Informe um e-mail válido.")
    .max(320),
  password: z
    .string({ error: "Informe a senha." })
    .min(6, "A senha deve ter pelo menos 6 caracteres.")
    .max(200),
  phone: optionalPhone,
  dateOfBirth: z.preprocess(
    (value) => (value === "" || value == null ? undefined : value),
    z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de nascimento inválida.")
      .optional(),
  ),
  redirect: z.string().optional(),
  inviteToken: z.string().trim().max(80).optional(),
});

export const updateB2cPatientProfileSchema = z.object({
  name: z
    .string({ error: "Informe seu nome." })
    .trim()
    .min(2, "Informe seu nome.")
    .max(200)
    .transform((value) => sanitizeText(value)),
  phone: z
    .string({ error: "Informe seu telefone." })
    .trim()
    .min(8, "Informe um telefone válido.")
    .max(40)
    .transform((value) =>
      sanitizeText(value).replace(/[^\d+\-\s()]/g, "").slice(0, 40),
    ),
  dateOfBirth: z
    .string({ error: "Informe a data de nascimento." })
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de nascimento inválida."),
});

export const toggleHealthTaskSchema = z.object({
  taskId: z.string().trim().min(1).max(64),
  isCompleted: z.boolean(),
  healthProfileId: z.string().trim().min(1).max(64).optional(),
});

const optionalBoundedInt = (max: number) =>
  z
    .number()
    .int()
    .min(0)
    .max(max)
    .nullable()
    .optional();

export const saveDailyHealthCheckSchema = z.object({
  healthProfileId: z.string().trim().min(1).max(64).optional(),
  day: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  waterMl: optionalBoundedInt(8000),
  sleepMinutes: optionalBoundedInt(16 * 60),
  sleepQuality: z.number().int().min(1).max(5).nullable().optional(),
  urineColor: z
    .enum(["pale", "yellow", "dark", "amber"])
    .nullable()
    .optional(),
  bristolType: z.number().int().min(1).max(7).nullable().optional(),
  stoolColor: z
    .enum(["brown", "yellow", "green", "pale", "black", "red"])
    .nullable()
    .optional(),
  activityMinutes: optionalBoundedInt(16 * 60),
});

export const wearableSyncSchema = z.object({
  healthProfileId: z.string().trim().min(1).max(64).optional(),
  day: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  source: z.enum(["apple_health", "health_connect", "garmin", "other"]),
  steps: optionalBoundedInt(200_000),
  sleepMinutes: optionalBoundedInt(16 * 60),
  activeMinutes: optionalBoundedInt(16 * 60),
});

export const setHealthShareSchema = z.object({
  healthProfileId: z.string().trim().min(1).max(64).optional(),
  professionalProfileId: z.string().trim().min(1).max(64),
  shared: z.boolean(),
});

export const addHealthJournalEntrySchema = z.object({
  healthProfileId: z.string().trim().min(1).max(64).optional(),
  body: z
    .string({ error: "Escreva o que você sentiu." })
    .trim()
    .min(4, "Escreva um pouco mais sobre como você está.")
    .max(
      MAX_HEALTH_JOURNAL_CHARS,
      "Relato muito longo. Divida em mais de um registro.",
    )
    .transform((value) => sanitizeText(value)),
});

const profileId = z.string().trim().min(1).max(64);
const listItem = z.string().trim().max(400);

export const updateHealthJournalEntrySchema = z.object({
  healthProfileId: profileId.optional(),
  entryId: profileId,
  body: z
    .string()
    .trim()
    .min(4, "O relato não pode ficar vazio.")
    .max(MAX_HEALTH_JOURNAL_CHARS)
    .transform((value) => sanitizeText(value)),
});

export const updateHealthConsultationReviewSchema = z.object({
  healthProfileId: profileId.optional(),
  summaryId: profileId,
  explanation: z.string().trim().min(1, "A explicação não pode ficar vazia.").max(12_000),
  professionalName: z.string().max(200).optional(),
  specialty: z.string().max(200).optional(),
  recommendations: z.array(listItem).max(12),
  attentionPoints: z.array(listItem).max(12),
  orientations: z.array(listItem).max(12),
});

export const updateHealthPanoramaSchema = z.object({
  healthProfileId: profileId.optional(),
  panorama: z.string().trim().max(6_000),
});

export const healthChatMessageSchema = z.object({
  text: z
    .string({ error: "Escreva sua pergunta." })
    .trim()
    .min(1, "Escreva sua pergunta.")
    .max(4000, "Mensagem muito longa.")
    .transform((value) => sanitizeText(value)),
  healthProfileId: z.string().trim().min(1).max(64).optional(),
});

export const setActiveHealthProfileSchema = z.object({
  healthProfileId: z.string().trim().min(1).max(64),
});

const optionalCareDate = z.preprocess(
  (value) => (value === "" || value == null ? undefined : value),
  z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de nascimento inválida.")
    .optional(),
);

const optionalCareLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => {
      if (!value) return "";
      return sanitizeText(value).slice(0, max);
    });

export const createHealthProfileSchema = z.object({
  name: z
    .string({ error: "Informe o nome." })
    .trim()
    .min(2, "Informe o nome.")
    .max(200)
    .transform((value) => sanitizeText(value)),
  relationship: z.enum(["child", "spouse", "parent", "other"], {
    error: "Informe o parentesco.",
  }),
  dateOfBirth: optionalCareDate,
  phone: optionalPhone,
  insuranceName: optionalCareLine(160),
  treatments: optionalCareLine(2000),
  profileNotes: optionalCareLine(2000),
});

export const updateHealthCareProfileSchema = z.object({
  healthProfileId: z.string().trim().min(1).max(64),
  name: z
    .string({ error: "Informe o nome." })
    .trim()
    .min(2, "Informe o nome.")
    .max(200)
    .transform((value) => sanitizeText(value)),
  relationship: z.enum(["self", "child", "spouse", "parent", "other"]).optional(),
  dateOfBirth: optionalCareDate,
  phone: optionalPhone,
  insuranceName: optionalCareLine(160),
  treatments: optionalCareLine(2000),
  profileNotes: optionalCareLine(2000),
});

/** Limite de perfis por conta B2C (titular + dependentes). */
export const MAX_HEALTH_PROFILES_PER_ACCOUNT = 8;

export type RegisterB2cPatientInput = z.infer<typeof registerB2cPatientSchema>;
export type UpdateB2cPatientProfileInput = z.infer<
  typeof updateB2cPatientProfileSchema
>;
