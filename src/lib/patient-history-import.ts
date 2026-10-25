/**
 * Constantes, schemas Zod e helpers da importação de histórico clínico
 * (paciente migrando de Nura, Zenfysio ou outra plataforma).
 */

import { z } from "zod";
import {
  MAX_HISTORY_IMPORT_FILE_BYTES,
  MAX_HISTORY_IMPORT_FILES,
  MAX_HISTORY_IMPORT_TOTAL_BYTES,
} from "@/lib/plan-limits";

export {
  MAX_HISTORY_IMPORT_FILE_BYTES,
  MAX_HISTORY_IMPORT_FILES,
  MAX_HISTORY_IMPORT_TOTAL_BYTES,
};

export const HISTORY_IMPORT_PLATFORMS = ["NURA", "ZENFYSIO", "OUTRO"] as const;
export type HistoryImportPlatform = (typeof HISTORY_IMPORT_PLATFORMS)[number];

export const HISTORY_IMPORT_PLATFORM_LABELS: Record<HistoryImportPlatform, string> = {
  NURA: "Nura",
  ZENFYSIO: "Zenfysio",
  OUTRO: "Outra plataforma",
};

export const ALLOWED_HISTORY_IMPORT_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export const historyImportPlatformSchema = z.enum(HISTORY_IMPORT_PLATFORMS);

/** Mínimo de caracteres por sessão (preview e commit — mesmo contrato). */
export const HISTORY_IMPORT_SESSION_CONTENT_MIN = 20;
export const HISTORY_IMPORT_SESSION_CONTENT_MAX = 20000;

export const historyImportSessionSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve ser YYYY-MM-DD")
    .optional()
    .nullable(),
  title: z.string().max(200).optional().nullable(),
  content: z
    .string()
    .min(HISTORY_IMPORT_SESSION_CONTENT_MIN)
    .max(HISTORY_IMPORT_SESSION_CONTENT_MAX),
});

/**
 * Sessão no commit: mesma regra de conteúdo do preview; data sem regex estrita
 * (o profissional pode editar livremente no formulário antes de gravar).
 */
export const historyImportCommitSessionSchema = z.object({
  date: z.string().optional().nullable(),
  title: z.string().max(200).optional().nullable(),
  content: z
    .string()
    .min(HISTORY_IMPORT_SESSION_CONTENT_MIN)
    .max(HISTORY_IMPORT_SESSION_CONTENT_MAX),
});

export const historyImportPatientSchema = z.object({
  name: z.string().min(2).max(200),
  age: z.string().max(40).optional().nullable(),
  diagnosis: z.string().max(500).optional().nullable(),
  history: z.string().max(8000).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  fatherName: z.string().max(200).optional().nullable(),
  motherName: z.string().max(200).optional().nullable(),
  companionName: z.string().max(200).optional().nullable(),
  companionPhone: z.string().max(40).optional().nullable(),
});

export const historyImportPatientContactsSchema = historyImportPatientSchema.pick({
  phone: true,
  fatherName: true,
  motherName: true,
  companionName: true,
  companionPhone: true,
});

export const historyImportPreviewSchema = z.object({
  patient: historyImportPatientSchema,
  sessions: z.array(historyImportSessionSchema).min(1).max(60),
  notes: z.string().max(2000).optional().nullable(),
});

export const historyImportCommitSchema = z.object({
  platform: historyImportPlatformSchema,
  patient: historyImportPatientSchema,
  sessions: z.array(historyImportCommitSessionSchema).min(1).max(60),
});

/** Anexo à ficha já existente: cada evolução precisa de data (extraída ou informada). */
export const historyImportAttachSessionSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data de cada evolução (AAAA-MM-DD)."),
  title: z.string().max(200).optional().nullable(),
  content: z
    .string()
    .min(HISTORY_IMPORT_SESSION_CONTENT_MIN)
    .max(HISTORY_IMPORT_SESSION_CONTENT_MAX),
});

export const historyImportAttachSchema = z.object({
  patientId: z.string().min(1, "Paciente inválido."),
  platform: historyImportPlatformSchema,
  sessions: z.array(historyImportAttachSessionSchema).min(1).max(60),
  patient: historyImportPatientContactsSchema.optional(),
});

export type HistoryImportSession = z.infer<typeof historyImportSessionSchema>;
export type HistoryImportPatient = z.infer<typeof historyImportPatientSchema>;
export type HistoryImportPreview = z.infer<typeof historyImportPreviewSchema>;
export type HistoryImportAttachInput = z.infer<typeof historyImportAttachSchema>;

export type HistoryImportFilePayload = {
  base64: string;
  mimeType: string;
  fileName: string;
};

export function validateHistoryImportFilesMeta(
  files: { size: number; mimeType: string; fileName: string }[],
): { ok: true } | { ok: false; error: string } {
  if (files.length === 0) {
    return { ok: false, error: "Anexe ao menos um documento do prontuário/evoluções." };
  }
  if (files.length > MAX_HISTORY_IMPORT_FILES) {
    return {
      ok: false,
      error: `Limite de ${MAX_HISTORY_IMPORT_FILES} ficheiros por importação. Remova alguns e tente de novo.`,
    };
  }
  let total = 0;
  for (const f of files) {
    const mime = (f.mimeType || "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_HISTORY_IMPORT_MIME.has(mime)) {
      return {
        ok: false,
        error: `Tipo não suportado: ${f.fileName}. Use PDF ou imagem (JPG/PNG/WebP).`,
      };
    }
    if (f.size > MAX_HISTORY_IMPORT_FILE_BYTES) {
      return {
        ok: false,
        error: `${f.fileName} excede ${Math.round(MAX_HISTORY_IMPORT_FILE_BYTES / (1024 * 1024))} MB.`,
      };
    }
    total += f.size;
  }
  if (total > MAX_HISTORY_IMPORT_TOTAL_BYTES) {
    return {
      ok: false,
      error: `O lote excede ${Math.round(MAX_HISTORY_IMPORT_TOTAL_BYTES / (1024 * 1024))} MB no total. Divida em duas importações.`,
    };
  }
  return { ok: true };
}

/** Prompt de sistema para segmentar documentos externos em evoluções datadas. */
export function buildHistoryImportSystemPrompt(
  platform: HistoryImportPlatform,
  options?: { existingPatientName?: string },
): string {
  const platformLabel = HISTORY_IMPORT_PLATFORM_LABELS[platform];
  const existing = options?.existingPatientName?.trim();
  const context = existing
    ? `CONTEXTO: O profissional está a anexar evoluções avulsas ou em lote à ficha JÁ CADASTRADA de "${existing}", vindas de "${platformLabel}" (ou similar). Ignore cadastro de paciente novo. Foque em segmentar sessões e extrair a data de cada atendimento.`
    : `CONTEXTO: O profissional está a importar o histórico de um paciente vindo de "${platformLabel}" (ou similar). Os anexos são PDFs/imagens de evoluções, prontuários ou relatórios.`;
  return `Você é um assistente clínico que migra prontuários/evoluções de outra plataforma para o AI Evolui.

${context}

TAREFA:
1. Identificar o paciente (nome completo, idade se houver, diagnóstico/queixa principal se houver, breve histórico se houver, telefone, nome do pai/mãe/acompanhante se constarem).
2. Segmentar o material em SESSÕES/EVOLUÇÕES clínicas distintas (idealmente uma por data de atendimento).
3. Para cada sessão: data (YYYY-MM-DD se legível; senão null), título curto opcional, e conteúdo clínico em português (texto corrido, sem markdown).

REGRAS:
- NÃO invente dados clínicos, nomes, datas ou diagnósticos ausentes nos documentos.
- Se várias sessões no mesmo ficheiro, separe-as.
- Se um ficheiro for um único relatório sem datas claras, crie uma sessão com date null e o conteúdo completo.
- Ordene as sessões da mais antiga para a mais recente.
- Máximo 40 sessões no JSON.
- Responda APENAS com JSON válido (sem markdown, sem cercas):

{
  "patient": {
    "name": "Nome Completo",
    "age": "45" | null,
    "diagnosis": "..." | null,
    "history": "resumo curto do caso se disponível" | null,
    "phone": "telefone do paciente ou null",
    "fatherName": "nome do pai ou null",
    "motherName": "nome da mãe ou null",
    "companionName": "acompanhante/responsável ou null",
    "companionPhone": "telefone do acompanhante ou null"
  },
  "sessions": [
    { "date": "2024-03-15" | null, "title": "Sessão / Evolução" | null, "content": "texto clínico..." }
  ],
  "notes": "avisos ao profissional sobre ambiguidades" | null
}`;
}

/** Extrai o primeiro objeto JSON de uma resposta LLM. */
export function extractJsonObject(text: string): unknown {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("A IA não devolveu JSON válido.");
  }
  return JSON.parse(match[0]) as unknown;
}

/** Converte YYYY-MM-DD (ou null) em Date local ao meio-dia. */
export function parseImportSessionDate(raw: string | null | undefined): Date {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date();
  }
  const [y, m, d] = raw.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d!, 12, 0, 0, 0);
  if (Number.isNaN(dt.getTime())) return new Date();
  return dt;
}

export function isImportSessionDate(raw: string | null | undefined): raw is string {
  return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw);
}

/** Ordena sessões pela data extraída/informada; sem data ficam no fim. */
export function sortHistoryImportSessions<T extends { date?: string | null }>(
  sessions: T[],
): T[] {
  return [...sessions].sort((a, b) => {
    const ad = isImportSessionDate(a.date) ? a.date : "9999-12-31";
    const bd = isImportSessionDate(b.date) ? b.date : "9999-12-31";
    return ad.localeCompare(bd);
  });
}
