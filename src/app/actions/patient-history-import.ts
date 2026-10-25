"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { EvolutionSource, type Prisma } from "@prisma/client";
import type { Part } from "@google/generative-ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { sanitizeText } from "@/lib/sanitize";
import { scheduleCrmAccountSync } from "@/lib/crm/touch";
import {
  canAddPatient,
  canImportPatientHistory,
  getMaxHistoryImportsPerMonth,
  resolveSessionEmail,
} from "@/lib/plan-limits";
import {
  aiBillingRateLimitMessage,
  enforceAiBillingRateLimit,
} from "@/lib/ai-billing-rate-limit";
import {
  getPatientAccessScope,
  PROFILE_REQUIRED_ERROR,
} from "@/lib/intra-user/patient-access";
import { buildPatientScopeWhere } from "@/lib/intra-user/patient-scope";
import { clinicalPatientWhere } from "@/lib/patient-clinical-scope";
import { updatePatientSummary } from "@/app/actions/patient";
import {
  ALLOWED_HISTORY_IMPORT_MIME,
  HISTORY_IMPORT_SESSION_CONTENT_MIN,
  buildHistoryImportSystemPrompt,
  extractJsonObject,
  historyImportAttachSchema,
  historyImportCommitSchema,
  historyImportPlatformSchema,
  historyImportPreviewSchema,
  MAX_HISTORY_IMPORT_FILE_BYTES,
  MAX_HISTORY_IMPORT_FILES,
  MAX_HISTORY_IMPORT_TOTAL_BYTES,
  parseImportSessionDate,
  sortHistoryImportSessions,
  validateHistoryImportFilesMeta,
  type HistoryImportFilePayload,
  type HistoryImportPlatform,
  type HistoryImportPreview,
} from "@/lib/patient-history-import";
import {
  contactsFromEnglishDraft,
  mergeOptionalContactsKeepExisting,
  parseOptionalContactsFromAi,
  type PatientOptionalContacts,
} from "@/lib/patient-optional-contacts";
import { clinicalGenerationConfig } from "@/lib/clinical-harness";

function persistImportedContacts(draft: {
  phone?: string | null;
  fatherName?: string | null;
  motherName?: string | null;
  companionName?: string | null;
  companionPhone?: string | null;
}): PatientOptionalContacts {
  const c = contactsFromEnglishDraft(draft);
  const name = (v: string | null) => (v ? sanitizeText(v) || null : null);
  return {
    phone: c.phone,
    fatherName: name(c.fatherName),
    motherName: name(c.motherName),
    companionName: name(c.companionName),
    companionPhone: c.companionPhone,
  };
}

const ANALYZE_TIMEOUT_MS = 120_000;
const FILES_PER_CHUNK = 4;

async function getDbUserForImport() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !authUser?.id) return null;

  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [{ authUserId: authUser.id }, { email: authUser.email ?? "" }],
    },
    select: {
      id: true,
      plan: true,
      email: true,
      isInfluencer: true,
      patientCount: true,
      historyImportCount: true,
      historyImportCountResetAt: true,
    },
  });
  if (!dbUser) return null;
  return {
    ...dbUser,
    sessionEmail: resolveSessionEmail(authUser.email, dbUser.email),
  };
}

function isUtcMonthStale(resetAt: Date | null, now: Date): boolean {
  return (
    !resetAt ||
    resetAt.getUTCMonth() !== now.getUTCMonth() ||
    resetAt.getUTCFullYear() !== now.getUTCFullYear()
  );
}

function historyImportQuotaExceededMessage(max: number): string {
  const capLabel = Number.isFinite(max) ? String(max) : "ilimitado";
  return `Limite mensal de importações de histórico atingido (${capLabel}/mês no seu plano). Faça upgrade ou aguarde o próximo mês.`;
}

type HistoryImportUserQuotaCtx = {
  id: string;
  plan: string | null;
  email: string | null;
  isInfluencer: boolean;
  sessionEmail: string | null;
};

/**
 * Lê a cota no banco e, se mudou o mês UTC, zera o contador (persistido).
 * Usado pela UI e pela checagem prévia de analyze — sempre dados frescos.
 */
async function syncAndReadHistoryImportQuota(
  dbUser: HistoryImportUserQuotaCtx,
): Promise<{ used: number; max: number }> {
  const now = new Date();
  const row = await prisma.user.findUnique({
    where: { id: dbUser.id },
    select: {
      historyImportCount: true,
      historyImportCountResetAt: true,
    },
  });
  if (!row) {
    return { used: 0, max: 0 };
  }

  const max = getMaxHistoryImportsPerMonth(
    dbUser.plan,
    dbUser.sessionEmail ?? dbUser.email,
    dbUser.isInfluencer,
  );

  if (isUtcMonthStale(row.historyImportCountResetAt, now)) {
    await prisma.user.update({
      where: { id: dbUser.id },
      data: { historyImportCount: 0, historyImportCountResetAt: now },
    });
    return { used: 0, max };
  }

  return { used: row.historyImportCount, max };
}

/** Soft-check (analyze / early exit): sync mês + valida limite com contagem atual. */
async function ensureHistoryImportQuota(
  dbUser: HistoryImportUserQuotaCtx,
): Promise<
  | { ok: true; effectiveCount: number; max: number }
  | { ok: false; error: string }
> {
  const { used, max } = await syncAndReadHistoryImportQuota(dbUser);

  if (
    !canImportPatientHistory(
      dbUser.plan,
      used,
      dbUser.sessionEmail ?? dbUser.email,
      dbUser.isInfluencer,
    )
  ) {
    return { ok: false, error: historyImportQuotaExceededMessage(max) };
  }

  return { ok: true, effectiveCount: used, max };
}

class HistoryImportQuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HistoryImportQuotaExceededError";
  }
}

/**
 * Dentro da transaction do commit: revalida mês/cota e reserva +1 de forma
 * atómica (`updateMany` com `historyImportCount < max`), evitando corridas
 * entre commits paralelos após vários analyzes.
 */
async function claimHistoryImportSlotInTx(
  tx: Prisma.TransactionClient,
  dbUser: HistoryImportUserQuotaCtx,
  options?: { incrementPatientCount?: boolean },
): Promise<{ usedAfter: number; max: number }> {
  const incrementPatientCount = options?.incrementPatientCount !== false;
  const now = new Date();
  const row = await tx.user.findUnique({
    where: { id: dbUser.id },
    select: {
      historyImportCount: true,
      historyImportCountResetAt: true,
    },
  });
  if (!row) {
    throw new HistoryImportQuotaExceededError("Usuário não encontrado.");
  }

  const max = getMaxHistoryImportsPerMonth(
    dbUser.plan,
    dbUser.sessionEmail ?? dbUser.email,
    dbUser.isInfluencer,
  );

  let countBeforeIncrement = row.historyImportCount;
  if (isUtcMonthStale(row.historyImportCountResetAt, now)) {
    await tx.user.update({
      where: { id: dbUser.id },
      data: { historyImportCount: 0, historyImportCountResetAt: now },
    });
    countBeforeIncrement = 0;
  }

  const incrementData = incrementPatientCount
    ? {
        historyImportCount: { increment: 1 },
        patientCount: { increment: 1 },
      }
    : { historyImportCount: { increment: 1 } };

  if (!Number.isFinite(max)) {
    await tx.user.update({
      where: { id: dbUser.id },
      data: incrementData,
    });
    return { usedAfter: countBeforeIncrement + 1, max };
  }

  const claimed = await tx.user.updateMany({
    where: {
      id: dbUser.id,
      historyImportCount: { lt: max },
    },
    data: incrementData,
  });

  if (claimed.count === 0) {
    throw new HistoryImportQuotaExceededError(historyImportQuotaExceededMessage(max));
  }

  return { usedAfter: Math.min(countBeforeIncrement + 1, max), max };
}

async function filesFromFormData(formData: FormData): Promise<
  | { ok: true; files: HistoryImportFilePayload[]; meta: { size: number; mimeType: string; fileName: string }[] }
  | { ok: false; error: string }
> {
  const raw = formData.getAll("files").filter((v): v is File => v instanceof File);
  if (raw.length === 0) {
    return { ok: false, error: "Anexe ao menos um documento." };
  }
  if (raw.length > MAX_HISTORY_IMPORT_FILES) {
    return {
      ok: false,
      error: `Limite de ${MAX_HISTORY_IMPORT_FILES} ficheiros por importação.`,
    };
  }

  const meta: { size: number; mimeType: string; fileName: string }[] = [];
  const files: HistoryImportFilePayload[] = [];
  let total = 0;

  for (const file of raw) {
    const mime = (file.type || "").split(";")[0].trim().toLowerCase();
    const resolvedMime =
      mime && ALLOWED_HISTORY_IMPORT_MIME.has(mime)
        ? mime
        : file.name.toLowerCase().endsWith(".pdf")
          ? "application/pdf"
          : mime;

    if (!ALLOWED_HISTORY_IMPORT_MIME.has(resolvedMime)) {
      return {
        ok: false,
        error: `Tipo não suportado: ${file.name}. Use PDF ou imagem (JPG/PNG/WebP).`,
      };
    }
    if (file.size > MAX_HISTORY_IMPORT_FILE_BYTES) {
      return {
        ok: false,
        error: `${file.name} excede ${Math.round(MAX_HISTORY_IMPORT_FILE_BYTES / (1024 * 1024))} MB.`,
      };
    }
    total += file.size;
    if (total > MAX_HISTORY_IMPORT_TOTAL_BYTES) {
      return {
        ok: false,
        error: `O lote excede ${Math.round(MAX_HISTORY_IMPORT_TOTAL_BYTES / (1024 * 1024))} MB no total.`,
      };
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    files.push({
      base64: buffer.toString("base64"),
      mimeType: resolvedMime,
      fileName: file.name,
    });
    meta.push({ size: file.size, mimeType: resolvedMime, fileName: file.name });
  }

  const check = validateHistoryImportFilesMeta(meta);
  if (!check.ok) return { ok: false, error: check.error };
  return { ok: true, files, meta };
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

async function analyzeChunk(
  platform: HistoryImportPlatform,
  chunk: HistoryImportFilePayload[],
  chunkIndex: number,
  totalChunks: number,
  existingPatientName?: string,
): Promise<HistoryImportPreview> {
  const { generateContentSafeWithModelFallback } = await import("@/lib/gemini");

  const parts: Part[] = [
    {
      text: `${buildHistoryImportSystemPrompt(platform, { existingPatientName })}

Lote ${chunkIndex + 1}/${totalChunks}. Analise os anexos abaixo e devolva o JSON.`,
    },
  ];

  for (const file of chunk) {
    parts.push({
      text: `\n--- Ficheiro: ${file.fileName} (${file.mimeType}) ---`,
    });
    parts.push({
      inlineData: {
        mimeType: file.mimeType,
        data: file.base64,
      },
    });
  }

  const { result } = await generateContentSafeWithModelFallback(
    {
      generationConfig: clinicalGenerationConfig({ maxOutputTokens: 8192 }),
    },
    parts,
    ANALYZE_TIMEOUT_MS,
  );

  const text = result.response.text();
  const raw = extractJsonObject(text);
  const parsed = historyImportPreviewSchema.safeParse(normalizeHistoryImportPatientJson(raw));
  if (!parsed.success) {
    throw new Error(
      `Resposta da IA inválida no lote ${chunkIndex + 1}: ${parsed.error.issues[0]?.message ?? "formato"}`,
    );
  }
  return parsed.data;
}

function normalizeHistoryImportPatientJson(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;
  const patient = obj.patient;
  if (!patient || typeof patient !== "object") return raw;
  const p = patient as Record<string, unknown>;
  const contacts = parseOptionalContactsFromAi(p);
  return {
    ...obj,
    patient: {
      ...p,
      phone: typeof p.phone === "string" ? p.phone : contacts.telefone ?? null,
      fatherName: typeof p.fatherName === "string" ? p.fatherName : contacts.nomePai ?? null,
      motherName: typeof p.motherName === "string" ? p.motherName : contacts.nomeMae ?? null,
      companionName:
        typeof p.companionName === "string" ? p.companionName : contacts.nomeAcompanhante ?? null,
      companionPhone:
        typeof p.companionPhone === "string"
          ? p.companionPhone
          : contacts.telefoneAcompanhante ?? null,
    },
  };
}

function mergePatientHistoryFields(
  a: string | null | undefined,
  b: string | null | undefined,
): string | null {
  const parts = [a, b]
    .map((h) => (typeof h === "string" ? h.trim() : ""))
    .filter((h) => h.length > 0);
  if (parts.length === 0) return null;
  // Evita duplicar o mesmo bloco quando dois lotes repetem o histórico.
  const unique: string[] = [];
  for (const p of parts) {
    if (!unique.some((u) => u.toLowerCase() === p.toLowerCase())) {
      unique.push(p);
    }
  }
  return unique.join("\n\n") || null;
}

function mergePreviews(parts: HistoryImportPreview[]): HistoryImportPreview {
  if (parts.length === 1) return parts[0]!;

  const bestPatient = parts.reduce((acc, p) => {
    const name = p.patient.name?.trim() || "";
    const mergedHistory = mergePatientHistoryFields(acc.history, p.patient.history);
    const pick = (next?: string | null, prev?: string | null) =>
      (next && next.trim()) || prev || null;
    const contacts = {
      phone: pick(p.patient.phone, acc.phone),
      fatherName: pick(p.patient.fatherName, acc.fatherName),
      motherName: pick(p.patient.motherName, acc.motherName),
      companionName: pick(p.patient.companionName, acc.companionName),
      companionPhone: pick(p.patient.companionPhone, acc.companionPhone),
    };
    if (!acc.name || (name.length > acc.name.length && name.toLowerCase() !== "desconhecido")) {
      return {
        name: name || acc.name,
        age: p.patient.age || acc.age,
        diagnosis: p.patient.diagnosis || acc.diagnosis,
        history: mergedHistory,
        ...contacts,
      };
    }
    return {
      name: acc.name,
      age: acc.age || p.patient.age,
      diagnosis: acc.diagnosis || p.patient.diagnosis,
      history: mergedHistory,
      phone: pick(acc.phone, p.patient.phone),
      fatherName: pick(acc.fatherName, p.patient.fatherName),
      motherName: pick(acc.motherName, p.patient.motherName),
      companionName: pick(acc.companionName, p.patient.companionName),
      companionPhone: pick(acc.companionPhone, p.patient.companionPhone),
    };
  }, parts[0]!.patient);

  const sessions = parts.flatMap((p) => p.sessions);
  const notes = parts
    .map((p) => p.notes)
    .filter((n): n is string => !!n && n.trim().length > 0)
    .join(" | ");

  const merged = historyImportPreviewSchema.safeParse({
    patient: bestPatient,
    sessions,
    notes: notes || null,
  });
  if (!merged.success) {
    throw new Error("Falha ao fundir os lotes de análise.");
  }
  return merged.data;
}

export interface AnalyzeHistoryImportResult {
  success: boolean;
  preview?: HistoryImportPreview;
  platform?: HistoryImportPlatform;
  importsUsed?: number;
  importsLimit?: number | null;
  error?: string;
}

/**
 * Analisa documentos de outra plataforma e devolve preview editável
 * (paciente + sessões). Não grava nada ainda.
 */
export async function analyzePatientHistoryImport(
  formData: FormData,
): Promise<AnalyzeHistoryImportResult> {
  try {
    const dbUser = await getDbUserForImport();
    if (!dbUser) {
      return { success: false, error: "Usuário não autenticado." };
    }

    const scope = await getPatientAccessScope();
    if (!scope || scope.denied || !scope.activeIntraUser) {
      return { success: false, error: PROFILE_REQUIRED_ERROR };
    }

    const quota = await ensureHistoryImportQuota(dbUser);
    if (quota.ok === false) {
      return { success: false, error: quota.error };
    }

    const platformRaw = String(formData.get("platform") || "OUTRO");
    const platformParsed = historyImportPlatformSchema.safeParse(platformRaw);
    if (!platformParsed.success) {
      return { success: false, error: "Plataforma de origem inválida." };
    }
    const platform = platformParsed.data;
    const existingPatientName = String(formData.get("existingPatientName") || "").trim();

    const filesResult = await filesFromFormData(formData);
    if (filesResult.ok === false) {
      return { success: false, error: filesResult.error };
    }

    const rl = await enforceAiBillingRateLimit({
      userKey: `history-import:${dbUser.id}`,
    });
    if (!rl.allowed) {
      return {
        success: false,
        error: aiBillingRateLimitMessage(rl.resetIn),
      };
    }

    const chunks = chunkArray(filesResult.files, FILES_PER_CHUNK);
    const chunkResults: HistoryImportPreview[] = [];
    for (let i = 0; i < chunks.length; i++) {
      chunkResults.push(
        await analyzeChunk(
          platform,
          chunks[i]!,
          i,
          chunks.length,
          existingPatientName || undefined,
        ),
      );
    }

    const preview = mergePreviews(chunkResults);

    return {
      success: true,
      preview,
      platform,
      importsUsed: quota.effectiveCount,
      importsLimit: Number.isFinite(quota.max) ? quota.max : null,
    };
  } catch (error) {
    console.error("[analyzePatientHistoryImport]", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Erro ao analisar documentos. Tente novamente.",
    };
  }
}

const commitSchema = historyImportCommitSchema;

export interface CommitHistoryImportResult {
  success: boolean;
  patientId?: string;
  patientName?: string;
  evolutionCount?: number;
  importBatchId?: string;
  error?: string;
}

/**
 * Confirma o preview: cria ficha do paciente + evoluções IMPORTED
 * (não incrementa evolutionCount; incrementa historyImportCount).
 */
export async function commitPatientHistoryImport(
  input: z.infer<typeof commitSchema>,
): Promise<CommitHistoryImportResult> {
  try {
    const parsed = commitSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Dados inválidos.",
      };
    }

    const dbUser = await getDbUserForImport();
    if (!dbUser) {
      return { success: false, error: "Usuário não autenticado." };
    }

    const scope = await getPatientAccessScope();
    if (!scope || scope.denied || !scope.activeIntraUser) {
      return { success: false, error: PROFILE_REQUIRED_ERROR };
    }
    const activeIntraUserId = scope.activeIntraUser.id;

    const quota = await ensureHistoryImportQuota(dbUser);
    if (quota.ok === false) {
      return { success: false, error: quota.error };
    }

    if (
      !canAddPatient(
        dbUser.plan,
        dbUser.patientCount,
        dbUser.sessionEmail ?? dbUser.email,
        dbUser.isInfluencer,
      )
    ) {
      return {
        success: false,
        error: "Limite de pacientes atingido. Faça upgrade para cadastrar mais pacientes.",
      };
    }

    const { platform, patient: patientDraft, sessions } = parsed.data;
    const patientName = sanitizeText(patientDraft.name.trim());
    if (patientName.length < 2) {
      return { success: false, error: "Nome do paciente é obrigatório." };
    }

    const importBatchId = randomUUID();
    const age = patientDraft.age ? sanitizeText(patientDraft.age.trim()) : null;
    const diagnosis = patientDraft.diagnosis
      ? sanitizeText(patientDraft.diagnosis.trim())
      : null;
    const history = patientDraft.history
      ? sanitizeText(patientDraft.history.trim())
      : null;
    const contacts = persistImportedContacts(patientDraft);

    const preparedSessions = prepareImportedEvolutionRows(sessions);

    if (preparedSessions.length === 0) {
      return { success: false, error: "Nenhuma sessão válida para gravar." };
    }

    const result = await prisma.$transaction(async (tx) => {
      const patient = await tx.patient.create({
        data: {
          name: patientName,
          age: age || null,
          diagnosis: diagnosis || null,
          history: history || null,
          ...contacts,
          userId: dbUser.id,
          ownerId: activeIntraUserId,
          isShared: false,
          agendaOnly: false,
        },
      });

      await tx.evolution.createMany({
        data: preparedSessions.map((s) => ({
          patientId: patient.id,
          content: s.content,
          date: s.date,
          source: EvolutionSource.IMPORTED,
          importBatchId,
          importedFrom: platform,
          tags: ["importado"],
        })),
      });

      const latestDate = preparedSessions.reduce(
        (maxDate, s) => (s.date > maxDate ? s.date : maxDate),
        preparedSessions[0]!.date,
      );

      await tx.patient.update({
        where: { id: patient.id },
        data: { lastVisit: latestDate },
      });

      // Reserva atómica no fim: se a cota já foi consumida por outro commit,
      // o rollback desfaz paciente + evoluções criados acima.
      await claimHistoryImportSlotInTx(tx, dbUser);

      return { patient, evolutionCount: preparedSessions.length };
    });

    scheduleCrmAccountSync(dbUser.id);

    updatePatientSummary(result.patient.id).catch((err) => {
      console.error("[commitPatientHistoryImport] updatePatientSummary:", err);
    });

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/patients");
    revalidatePath(`/dashboard/patients/${result.patient.id}`);
    revalidatePath("/dashboard/new-evolution");

    return {
      success: true,
      patientId: result.patient.id,
      patientName: result.patient.name,
      evolutionCount: result.evolutionCount,
      importBatchId,
    };
  } catch (error) {
    if (error instanceof HistoryImportQuotaExceededError) {
      return { success: false, error: error.message };
    }
    console.error("[commitPatientHistoryImport]", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Erro ao cadastrar paciente importado.",
    };
  }
}

export interface HistoryImportQuotaResult {
  success: boolean;
  used?: number;
  limit?: number | null;
  canImport?: boolean;
  error?: string;
}

function prepareImportedEvolutionRows(
  sessions: { date?: string | null; title?: string | null; content: string }[],
): { content: string; date: Date }[] {
  return sortHistoryImportSessions(sessions)
    .map((s) => {
      const content = sanitizeText(s.content.trim());
      if (content.length < HISTORY_IMPORT_SESSION_CONTENT_MIN) return null;
      const title = s.title ? sanitizeText(s.title.trim()) : null;
      const date = parseImportSessionDate(s.date);
      const body = title ? `${title}\n\n${content}` : content;
      return { content: body, date };
    })
    .filter((s): s is { content: string; date: Date } => s !== null);
}

export interface AttachHistoryImportResult {
  success: boolean;
  patientId?: string;
  evolutionCount?: number;
  importBatchId?: string;
  error?: string;
}

/**
 * Anexa evoluções IMPORTED a um paciente já cadastrado.
 * Não cria ficha nem incrementa patientCount; consome 1 slot da cota mensal.
 */
export async function commitPatientExistingHistoryImport(
  input: z.infer<typeof historyImportAttachSchema>,
): Promise<AttachHistoryImportResult> {
  try {
    const parsed = historyImportAttachSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Dados inválidos.",
      };
    }

    const dbUser = await getDbUserForImport();
    if (!dbUser) {
      return { success: false, error: "Usuário não autenticado." };
    }

    const scope = await getPatientAccessScope();
    if (!scope || scope.denied || !scope.activeIntraUser) {
      return { success: false, error: PROFILE_REQUIRED_ERROR };
    }

    const quota = await ensureHistoryImportQuota(dbUser);
    if (quota.ok === false) {
      return { success: false, error: quota.error };
    }

    const { patientId, platform, sessions, patient: contactDraft } = parsed.data;
    const preparedSessions = prepareImportedEvolutionRows(sessions);
    if (preparedSessions.length === 0) {
      return { success: false, error: "Nenhuma sessão válida para gravar." };
    }

    const importBatchId = randomUUID();

    const result = await prisma.$transaction(async (tx) => {
      const patient = await tx.patient.findFirst({
        where: {
          ...buildPatientScopeWhere(scope),
          id: patientId,
          ...clinicalPatientWhere,
        },
        select: {
          id: true,
          lastVisit: true,
          phone: true,
          fatherName: true,
          motherName: true,
          companionName: true,
          companionPhone: true,
        },
      });
      if (!patient) {
        throw new Error("Paciente não encontrado.");
      }

      await tx.evolution.createMany({
        data: preparedSessions.map((s) => ({
          patientId: patient.id,
          content: s.content,
          date: s.date,
          source: EvolutionSource.IMPORTED,
          importBatchId,
          importedFrom: platform,
          tags: ["importado"],
        })),
      });

      const latestDate = preparedSessions.reduce(
        (maxDate, s) => (s.date > maxDate ? s.date : maxDate),
        preparedSessions[0]!.date,
      );

      const mergedContacts = persistImportedContacts(
        mergeOptionalContactsKeepExisting(
          {
            telefone: contactDraft?.phone,
            nomePai: contactDraft?.fatherName,
            nomeMae: contactDraft?.motherName,
            nomeAcompanhante: contactDraft?.companionName,
            telefoneAcompanhante: contactDraft?.companionPhone,
          },
          patient,
        ),
      );

      await tx.patient.update({
        where: { id: patient.id },
        data: {
          ...mergedContacts,
          ...(!patient.lastVisit || latestDate > patient.lastVisit
            ? { lastVisit: latestDate }
            : {}),
        },
      });

      await claimHistoryImportSlotInTx(tx, dbUser, { incrementPatientCount: false });

      return { evolutionCount: preparedSessions.length };
    });

    updatePatientSummary(patientId).catch((err) => {
      console.error("[commitPatientExistingHistoryImport] updatePatientSummary:", err);
    });

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/patients");
    revalidatePath(`/dashboard/patients/${patientId}`);

    return {
      success: true,
      patientId,
      evolutionCount: result.evolutionCount,
      importBatchId,
    };
  } catch (error) {
    if (error instanceof HistoryImportQuotaExceededError) {
      return { success: false, error: error.message };
    }
    console.error("[commitPatientExistingHistoryImport]", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Erro ao importar evoluções para este paciente.",
    };
  }
}

/** Quota mensal de importações para a UI. */
export async function getHistoryImportQuota(): Promise<HistoryImportQuotaResult> {
  try {
    const dbUser = await getDbUserForImport();
    if (!dbUser) {
      return { success: false, error: "Usuário não autenticado." };
    }

    const { used, max: limitRaw } = await syncAndReadHistoryImportQuota(dbUser);
    const limit = Number.isFinite(limitRaw) ? limitRaw : null;
    const canImport = canImportPatientHistory(
      dbUser.plan,
      used,
      dbUser.sessionEmail ?? dbUser.email,
      dbUser.isInfluencer,
    );

    return { success: true, used, limit, canImport };
  } catch (error) {
    console.error("[getHistoryImportQuota]", error);
    return { success: false, error: "Erro ao carregar cota de importação." };
  }
}
