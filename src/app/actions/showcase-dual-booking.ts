"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requireB2cPatientContext } from "@/lib/b2c/patient-session";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  createConversationDualBooking,
  setDualBookingState,
} from "@/lib/marketplace/dual-booking";

const slotSchema = z.object({
  profileId: z.string().cuid(),
  startAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
});

const professionalSlotSchema = z.object({
  patientId: z.string().min(1),
  startAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
});

const stateSchema = z.object({
  bookingId: z.string().cuid(),
  action: z.enum(["confirm", "cancel"]),
});

async function professionalUserId(): Promise<{ id: string } | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;
  const row = await prisma.user.findFirst({
    where: { OR: [{ authUserId: user.id }, { email: user.email }], isBlocked: false },
    select: { id: true },
  });
  return row;
}

function refreshSurfaces() {
  revalidatePath("/vitrine");
  revalidatePath("/mapa-saude");
  revalidatePath("/dashboard/agenda");
  revalidatePath("/dashboard/profile");
}

export async function bookDualFromPatientConversation(
  input: z.infer<typeof slotSchema>,
): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = slotSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Informe dia e horário." };
  const access = await requireB2cPatientContext();
  if (!access.ok) return { success: false, error: "Entre na sua conta de paciente." };

  const limit = await enforceRateLimit(`showcase-dual:${access.ctx.patientId}`, {
    maxRequests: 8,
    windowSeconds: 3600,
  });
  if (!limit.allowed) {
    return { success: false, error: `Tente novamente em ${limit.resetIn}s.` };
  }

  const result = await createConversationDualBooking({
    profileId: parsed.data.profileId,
    b2cPatientId: access.ctx.patientId,
    healthProfileId: access.ctx.healthProfileId,
    author: "PATIENT",
    startAtRaw: parsed.data.startAt,
  });
  if (!result.success) return result;
  refreshSurfaces();
  return { success: true };
}

export async function bookDualFromProfessionalConversation(
  input: z.infer<typeof professionalSlotSchema>,
): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = professionalSlotSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Informe dia e horário." };
  const professional = await professionalUserId();
  if (!professional) return { success: false, error: "Não autenticado." };

  const limit = await enforceRateLimit(`showcase-dual-pro:${professional.id}`, {
    maxRequests: 8,
    windowSeconds: 3600,
  });
  if (!limit.allowed) {
    return { success: false, error: `Tente novamente em ${limit.resetIn}s.` };
  }

  const profile = await prisma.professionalProfile.findUnique({
    where: { userId: professional.id },
    select: { id: true, showcaseApproved: true },
  });
  if (!profile?.showcaseApproved) {
    return { success: false, error: "Publique o card da vitrine para marcar por aqui." };
  }
  const healthProfile = await prisma.healthProfile.findFirst({
    where: { patientId: parsed.data.patientId, isPrimary: true },
    select: { id: true },
  });
  if (!healthProfile) {
    return { success: false, error: "O paciente ainda não tem agenda no mapa de saúde." };
  }

  const result = await createConversationDualBooking({
    profileId: profile.id,
    b2cPatientId: parsed.data.patientId,
    healthProfileId: healthProfile.id,
    author: "PROFESSIONAL",
    startAtRaw: parsed.data.startAt,
  });
  if (!result.success) return result;
  refreshSurfaces();
  return { success: true };
}

export async function setDualBookingFromPatient(
  input: z.infer<typeof stateSchema>,
): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = stateSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Não foi possível atualizar a consulta." };
  const access = await requireB2cPatientContext();
  if (!access.ok) return { success: false, error: "Entre na sua conta de paciente." };
  const result = await setDualBookingState({
    bookingId: parsed.data.bookingId,
    actor: "PATIENT",
    actorPatientId: access.ctx.patientId,
    action: parsed.data.action,
  });
  if (!result.success) return result;
  refreshSurfaces();
  return { success: true };
}

export async function setDualBookingFromProfessional(
  input: z.infer<typeof stateSchema>,
): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = stateSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Não foi possível atualizar a consulta." };
  const professional = await professionalUserId();
  if (!professional) return { success: false, error: "Não autenticado." };
  const result = await setDualBookingState({
    bookingId: parsed.data.bookingId,
    actor: "PROFESSIONAL",
    actorUserId: professional.id,
    action: parsed.data.action,
  });
  if (!result.success) return result;
  refreshSurfaces();
  return { success: true };
}
