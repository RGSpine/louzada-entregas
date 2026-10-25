"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import { requireB2cPatientContext } from "@/lib/b2c/patient-session";
import { firstZodError } from "@/lib/marketplace/schemas";
import {
  createMapWhatsAppInvite,
  invitePatientByEmail,
  linkProfessionalAsPatient,
  listPatientsWithoutMapAccount,
  listProfessionalLinks,
  listSharedUpdatesForChart,
  respondToProfessionalInvite,
  revokeProfessionalLink,
  searchLinkableProfessionals,
  setSharedUpdateStatus,
  shareHealthUpdateWithLinks,
} from "@/lib/b2c/professional-link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { enforceRateLimit } from "@/lib/rate-limit";

const shareSchema = z.object({
  healthProfileId: z.string().trim().min(1).max(64),
  professionalProfileIds: z.array(z.string().trim().min(1).max(64)).min(1).max(8),
  kind: z.enum(["JOURNAL", "CONSULTATION", "EXAM"]),
  sourceId: z.string().trim().min(1).max(64),
});

export async function getMyProfessionalLinks() {
  const auth = await requireB2cPatientContext();
  if (!auth.ok) return { success: false as const, error: auth.error };
  const links = await listProfessionalLinks(auth.ctx.healthProfileId);
  return { success: true as const, links };
}

export async function searchProfessionalsToLink(raw: unknown) {
  const parsed = z.object({ query: z.string().trim().min(2).max(80) }).safeParse(raw);
  if (!parsed.success) return { success: false as const, error: firstZodError(parsed.error) };
  const auth = await requireB2cPatientContext();
  if (!auth.ok) return { success: false as const, error: auth.error };
  const professionals = await searchLinkableProfessionals(parsed.data.query);
  return { success: true as const, professionals };
}

export async function linkProfessional(raw: unknown) {
  const parsed = z
    .object({ professionalProfileId: z.string().trim().min(1).max(64) })
    .safeParse(raw);
  if (!parsed.success) return { success: false as const, error: firstZodError(parsed.error) };
  const auth = await requireB2cPatientContext();
  if (!auth.ok) return { success: false as const, error: auth.error };
  const profile = await prisma.professionalProfile.findUnique({
    where: { id: parsed.data.professionalProfileId },
    select: { id: true, user: { select: { profession: true } } },
  });
  if (!profile) return { success: false as const, error: "Profissional não encontrado." };
  if (profile.user.profession === "Estudante") {
    return { success: false as const, error: "Esse cadastro não recebe vinculação." };
  }
  await linkProfessionalAsPatient({
    healthProfileId: auth.ctx.healthProfileId,
    professionalProfileId: profile.id,
  });
  revalidatePath("/mapa-saude", "layout");
  return { success: true as const };
}

export async function answerProfessionalInvite(raw: unknown) {
  const parsed = z
    .object({
      linkId: z.string().trim().min(1).max(64),
      accept: z.boolean(),
    })
    .safeParse(raw);
  if (!parsed.success) return { success: false as const, error: firstZodError(parsed.error) };
  const auth = await requireB2cPatientContext();
  if (!auth.ok) return { success: false as const, error: auth.error };
  const ok = await respondToProfessionalInvite({
    healthProfileId: auth.ctx.healthProfileId,
    linkId: parsed.data.linkId,
    accept: parsed.data.accept,
  });
  if (!ok) return { success: false as const, error: "Convite não encontrado." };
  revalidatePath("/mapa-saude", "layout");
  return { success: true as const };
}

export async function unlinkProfessional(raw: unknown) {
  const parsed = z.object({ linkId: z.string().trim().min(1).max(64) }).safeParse(raw);
  if (!parsed.success) return { success: false as const, error: firstZodError(parsed.error) };
  const auth = await requireB2cPatientContext();
  if (!auth.ok) return { success: false as const, error: auth.error };
  const ok = await revokeProfessionalLink({
    healthProfileId: auth.ctx.healthProfileId,
    linkId: parsed.data.linkId,
  });
  if (!ok) return { success: false as const, error: "Vínculo não encontrado." };
  revalidatePath("/mapa-saude", "layout");
  return { success: true as const };
}

export async function shareHealthItem(raw: unknown) {
  const parsed = shareSchema.safeParse(raw);
  if (!parsed.success) return { success: false as const, error: firstZodError(parsed.error) };
  const auth = await requireB2cPatientContext({
    healthProfileId: parsed.data.healthProfileId,
  });
  if (!auth.ok) return { success: false as const, error: auth.error };

  let title = "Atualização de saúde";
  let body = "";
  if (parsed.data.kind === "JOURNAL") {
    const entry = await prisma.healthJournalEntry.findFirst({
      where: { id: parsed.data.sourceId, healthProfileId: auth.ctx.healthProfileId },
      select: { body: true },
    });
    if (!entry) return { success: false as const, error: "Relato não encontrado." };
    title = "Novo relato";
    body = entry.body;
  } else {
    const summary = await prisma.clinicalSummary.findFirst({
      where: { id: parsed.data.sourceId, healthProfileId: auth.ctx.healthProfileId },
      select: { translatedExplanation: true, sourceType: true },
    });
    if (!summary) return { success: false as const, error: "Registro não encontrado." };
    const isExam = summary.sourceType === "exam_ocr";
    if (parsed.data.kind === "EXAM" && !isExam) {
      return { success: false as const, error: "Esse registro não é um exame." };
    }
    if (parsed.data.kind === "CONSULTATION" && isExam) {
      return { success: false as const, error: "Esse registro é um exame." };
    }
    title = isExam ? "Novo exame" : "Nova consulta";
    body = summary.translatedExplanation;
  }

  const activeProfile = auth.ctx.profiles.find(
    (profile) => profile.id === auth.ctx.healthProfileId,
  );
  const sent = await shareHealthUpdateWithLinks({
    healthProfileId: auth.ctx.healthProfileId,
    patientName: activeProfile?.name || auth.ctx.patientName,
    email: auth.ctx.email,
    phone: auth.ctx.phone,
    dateOfBirth: activeProfile?.dateOfBirth ?? auth.ctx.dateOfBirth,
    professionalProfileIds: parsed.data.professionalProfileIds,
    kind: parsed.data.kind,
    sourceId: parsed.data.sourceId,
    title: sanitizeText(title),
    body,
  });
  if (sent === 0) {
    return { success: false as const, error: "Escolha um profissional vinculado." };
  }
  revalidatePath("/dashboard", "layout");
  return { success: true as const, sent };
}

async function requireProfessionalUserId() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const dbUser = await prisma.user.findFirst({
    where: { authUserId: user.id },
    select: { id: true },
  });
  return dbUser?.id ?? null;
}

export async function getChartSharedUpdates(chartPatientId: string) {
  const userId = await requireProfessionalUserId();
  if (!userId) return { success: false as const, error: "Faça login para continuar." };
  const owns = await prisma.patient.findFirst({
    where: { id: chartPatientId, userId },
    select: { id: true, email: true, phone: true },
  });
  if (!owns) return { success: false as const, error: "Paciente não encontrado." };
  const updates = await listSharedUpdatesForChart({
    professionalUserId: userId,
    chartPatientId,
  });
  return {
    success: true as const,
    email: owns.email,
    phone: owns.phone,
    updates: updates.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

export async function reviewSharedUpdate(raw: unknown) {
  const parsed = z
    .object({
      updateId: z.string().trim().min(1).max(64),
      attach: z.boolean(),
    })
    .safeParse(raw);
  if (!parsed.success) return { success: false as const, error: firstZodError(parsed.error) };
  const userId = await requireProfessionalUserId();
  if (!userId) return { success: false as const, error: "Faça login para continuar." };
  const ok = await setSharedUpdateStatus({
    professionalUserId: userId,
    updateId: parsed.data.updateId,
    status: parsed.data.attach ? "ATTACHED" : "DISMISSED",
  });
  if (!ok) return { success: false as const, error: "Informação não encontrada." };
  revalidatePath("/dashboard", "layout");
  return { success: true as const };
}

export async function inviteChartPatientToMap(raw: unknown) {
  const parsed = z
    .object({ email: z.string().trim().email().max(320) })
    .safeParse(raw);
  if (!parsed.success) return { success: false as const, error: firstZodError(parsed.error) };
  const userId = await requireProfessionalUserId();
  if (!userId) return { success: false as const, error: "Faça login para continuar." };
  const owns = await prisma.patient.findFirst({
    where: {
      userId,
      agendaOnly: false,
      email: { equals: parsed.data.email, mode: "insensitive" },
    },
    select: { id: true },
  });
  if (!owns) {
    return { success: false as const, error: "Esse e-mail não está nesta ficha." };
  }
  const result = await invitePatientByEmail({
    professionalUserId: userId,
    email: parsed.data.email,
  });
  if (!result.ok) return { success: false as const, error: result.error };
  return { success: true as const, already: result.already };
}

export async function listMapInvitePatients() {
  const userId = await requireProfessionalUserId();
  if (!userId) return { success: false as const, error: "Faça login para continuar." };
  const data = await listPatientsWithoutMapAccount(userId);
  return { success: true as const, ...data };
}

export async function openMapWhatsAppInvite(raw: unknown) {
  const parsed = z
    .object({
      chartPatientId: z.string().trim().min(1).max(64),
      phone: z.string().trim().min(8).max(40),
    })
    .safeParse(raw);
  if (!parsed.success) return { success: false as const, error: firstZodError(parsed.error) };
  const userId = await requireProfessionalUserId();
  if (!userId) return { success: false as const, error: "Faça login para continuar." };
  const rl = await enforceRateLimit(`map-invite:${userId}`, {
    maxRequests: 30,
    windowSeconds: 3600,
  });
  if (!rl.allowed) {
    return { success: false as const, error: `Tente de novo em ${rl.resetIn}s.` };
  }
  const result = await createMapWhatsAppInvite({
    professionalUserId: userId,
    chartPatientId: parsed.data.chartPatientId,
    phone: parsed.data.phone,
  });
  if (!result.ok) return { success: false as const, error: result.error };
  return { success: true as const, whatsappUrl: result.whatsappUrl };
}
