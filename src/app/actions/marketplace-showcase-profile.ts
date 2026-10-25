"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { sanitizeText } from "@/lib/sanitize";
import { enforceRateLimit, PROFILE_LOGO_RATE_LIMIT } from "@/lib/rate-limit";
import { firstZodError } from "@/lib/marketplace/schemas";
import {
  canUseYieldManagement,
  YIELD_MANAGEMENT_PLAN_ERROR,
} from "@/lib/plan-limits";
import {
  geocodeAddress,
  writeProfessionalLocation,
} from "@/lib/marketplace/location";
import { scheduleMarketplaceSlotSync } from "@/lib/marketplace/marketplace-sync";
import { logger } from "@/lib/logger";
import { requireB2cPatientContext } from "@/lib/b2c/patient-session";
import { isShowcaseEligibleProfession } from "@/lib/marketplace/showcase-eligibility";
import { ensureShowcaseProfileForUser } from "@/lib/marketplace/ensure-showcase-profile";
import { professionOptions } from "@/lib/profession-options";
import { organizationPlanLabel } from "@/lib/plan-tier";

export type ShowcaseInquiryView = {
  id: string;
  patientName: string;
  body: string;
  createdAt: string;
};

export type ShowcaseChatMessage = {
  id: string;
  author: "PATIENT" | "PROFESSIONAL";
  body: string;
  createdAt: string;
};

export type ShowcaseDualBookingView = {
  id: string;
  startAt: string;
  status: "PENDING" | "CONFIRMED" | "CANCELLED";
};

export type ShowcaseChatThread = {
  patientId: string;
  patientName: string;
  messages: ShowcaseChatMessage[];
  bookings: ShowcaseDualBookingView[];
};

export type MarketplaceShowcaseData = {
  enabled: boolean;
  planAllowed: boolean;
  showcaseApproved: boolean;
  allowPatientAgendaBooking: boolean;
  professionalName: string;
  organizationLabel: "Consultório" | "Clínica" | null;
  profession: string;
  publicBio: string;
  publicHeadline: string;
  publicSpecialty: string;
  publicAveragePrice: string;
  publicPhotoUrl: string | null;
  mapsUrl: string;
  officeAddress: string;
  city: string;
  neighborhood: string;
  state: string;
  inquiries: ShowcaseInquiryView[];
  threads: ShowcaseChatThread[];
};

function formatAveragePriceInput(value: unknown): string {
  if (value == null) return "";
  const numeric = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(numeric)) return "";
  return numeric.toFixed(2).replace(".", ",");
}

function parseAveragePrice(raw: string | undefined): number | null {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return null;
  let normalized = trimmed.replace(/\s/g, "");
  if (normalized.includes(",") && normalized.includes(".")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (normalized.includes(",")) {
    normalized = normalized.replace(",", ".");
  }
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100000) return null;
  return Math.round(numeric * 100) / 100;
}

const mapsUrlSchema = z
  .string()
  .trim()
  .max(500)
  .optional()
  .or(z.literal(""))
  .refine(
    (value) => {
      if (!value) return true;
      try {
        const url = new URL(value);
        if (url.protocol !== "https:") return false;
        const host = url.hostname.replace(/^www\./, "");
        return (
          host === "maps.google.com" ||
          host === "google.com" ||
          host.endsWith(".google.com") ||
          host === "maps.app.goo.gl" ||
          host === "goo.gl" ||
          host === "openstreetmap.org" ||
          host.endsWith(".openstreetmap.org")
        );
      } catch {
        return false;
      }
    },
    { message: "Use um link https do Google Maps ou OpenStreetMap." },
  );

const showcaseSchema = z.object({
  showcaseApproved: z.boolean(),
  allowPatientAgendaBooking: z.boolean(),
  professionalName: z.string().trim().min(2, "Informe seu nome.").max(160),
  profession: z.string().trim().min(1, "Selecione sua profissão."),
  publicBio: z.string().trim().max(1200).optional().or(z.literal("")),
  publicHeadline: z.string().trim().max(160).optional().or(z.literal("")),
  publicSpecialty: z.string().trim().max(120).optional().or(z.literal("")),
  publicAveragePrice: z.string().trim().max(16).optional().or(z.literal("")),
  mapsUrl: mapsUrlSchema,
  officeAddress: z.string().trim().max(500).optional().or(z.literal("")),
  city: z.string().trim().max(80).optional().or(z.literal("")),
  neighborhood: z.string().trim().max(80).optional().or(z.literal("")),
  state: z
    .string()
    .trim()
    .max(2)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v.toUpperCase() : "")),
});

async function getAuthProfessional(): Promise<{
  id: string;
  email: string;
  name: string;
  profession: string;
  plan: string | null;
  isInfluencer: boolean;
  officeAddress: string | null;
  allowed: boolean;
} | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
    error,
  } = await supabase.auth.getUser();
  if (error || !authUser?.email) return null;

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ authUserId: authUser.id }, { email: authUser.email }],
    },
    select: {
      id: true,
      email: true,
      name: true,
      profession: true,
      plan: true,
      isInfluencer: true,
      officeAddress: true,
      isBlocked: true,
    },
  });
  if (!user || user.isBlocked) return null;

  return {
    id: user.id,
    email: user.email ?? authUser.email,
    name: user.name?.trim() || "",
    profession: user.profession?.trim() || "",
    plan: user.plan,
    isInfluencer: user.isInfluencer,
    officeAddress: user.officeAddress,
    allowed: canUseYieldManagement(user.plan, user.email, user.isInfluencer),
  };
}

async function loadShowcaseInquiries(
  profileId: string | null,
): Promise<ShowcaseInquiryView[]> {
  if (!profileId) return [];
  const rows = await prisma.showcaseInquiry.findMany({
    where: { professionalProfileId: profileId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      body: true,
      createdAt: true,
      patient: { select: { name: true } },
    },
  });
  await prisma.showcaseInquiry.updateMany({
    where: { professionalProfileId: profileId, readAt: null },
    data: { readAt: new Date() },
  });
  return rows.map((row) => ({
    id: row.id,
    patientName: row.patient.name?.trim() || "Paciente",
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  }));
}

async function loadShowcaseThreads(
  profileId: string | null,
): Promise<ShowcaseChatThread[]> {
  if (!profileId) return [];
  const [messages, inquiries, bookings] = await Promise.all([
    prisma.showcaseMessage.findMany({
      where: { professionalProfileId: profileId },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: {
        id: true,
        patientId: true,
        author: true,
        body: true,
        createdAt: true,
        patient: { select: { name: true } },
      },
    }),
    prisma.showcaseInquiry.findMany({
      where: { professionalProfileId: profileId },
      orderBy: { createdAt: "asc" },
      take: 40,
      select: {
        id: true,
        patientId: true,
        body: true,
        createdAt: true,
        patient: { select: { name: true } },
      },
    }),
    prisma.showcaseDualBooking.findMany({
      where: { professionalProfileId: profileId },
      orderBy: { startAt: "desc" },
      take: 80,
      select: {
        id: true,
        b2cPatientId: true,
        startAt: true,
        status: true,
        b2cPatient: { select: { name: true } },
      },
    }),
  ]);

  const byPatient = new Map<string, ShowcaseChatThread>();
  for (const row of inquiries) {
    const thread = byPatient.get(row.patientId) ?? {
      patientId: row.patientId,
      patientName: row.patient.name?.trim() || "Paciente",
      messages: [],
      bookings: [],
    };
    thread.messages.push({
      id: `inquiry-${row.id}`,
      author: "PATIENT",
      body: row.body,
      createdAt: row.createdAt.toISOString(),
    });
    byPatient.set(row.patientId, thread);
  }
  for (const row of messages) {
    const thread = byPatient.get(row.patientId) ?? {
      patientId: row.patientId,
      patientName: row.patient.name?.trim() || "Paciente",
      messages: [],
      bookings: [],
    };
    thread.messages.push({
      id: row.id,
      author: row.author,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
    });
    byPatient.set(row.patientId, thread);
  }
  for (const row of bookings) {
    const thread = byPatient.get(row.b2cPatientId) ?? {
      patientId: row.b2cPatientId,
      patientName: row.b2cPatient.name?.trim() || "Paciente",
      messages: [],
      bookings: [],
    };
    thread.bookings.push({
      id: row.id,
      startAt: row.startAt.toISOString(),
      status: row.status,
    });
    byPatient.set(row.b2cPatientId, thread);
  }

  return [...byPatient.values()]
    .map((thread) => ({
      ...thread,
      messages: thread.messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    }))
    .sort((a, b) => {
      const lastA = a.messages[a.messages.length - 1]?.createdAt ?? "";
      const lastB = b.messages[b.messages.length - 1]?.createdAt ?? "";
      return lastB.localeCompare(lastA);
    });
}

function toShowcaseData(input: {
  professional: {
    name: string;
    profession: string;
    plan: string | null;
    officeAddress: string | null;
  };
  planAllowed: boolean;
  profile: {
    yieldManagementEnabled: boolean;
    showcaseApproved: boolean;
    allowPatientAgendaBooking: boolean;
    publicBio: string | null;
    publicHeadline: string | null;
    publicSpecialty: string | null;
    publicAveragePrice: unknown;
    publicPhotoUrl: string | null;
    mapsUrl: string | null;
    city: string | null;
    neighborhood: string | null;
    state: string | null;
  } | null;
  inquiries: ShowcaseInquiryView[];
  threads: ShowcaseChatThread[];
  officeAddress?: string | null;
}): MarketplaceShowcaseData {
  const profile = input.profile;
  return {
    enabled: profile?.yieldManagementEnabled ?? false,
    planAllowed: input.planAllowed,
    showcaseApproved: profile?.showcaseApproved ?? false,
    allowPatientAgendaBooking: profile?.allowPatientAgendaBooking ?? false,
    professionalName: input.professional.name,
    organizationLabel: organizationPlanLabel(input.professional.plan),
    profession: input.professional.profession,
    publicBio: profile?.publicBio ?? "",
    publicHeadline: profile?.publicHeadline ?? "",
    publicSpecialty: profile?.publicSpecialty ?? "",
    publicAveragePrice: formatAveragePriceInput(profile?.publicAveragePrice),
    publicPhotoUrl: profile?.publicPhotoUrl ?? null,
    mapsUrl: profile?.mapsUrl ?? "",
    officeAddress: input.officeAddress ?? input.professional.officeAddress ?? "",
    city: profile?.city ?? "",
    neighborhood: profile?.neighborhood ?? "",
    state: profile?.state ?? "",
  inquiries: input.inquiries,
    threads: input.threads,
};
}

const profileSelect = {
  id: true,
  publicBio: true,
  publicHeadline: true,
  publicSpecialty: true,
  publicAveragePrice: true,
  publicPhotoUrl: true,
  mapsUrl: true,
  city: true,
  neighborhood: true,
  state: true,
  showcaseApproved: true,
  allowPatientAgendaBooking: true,
  yieldManagementEnabled: true,
} as const;

export async function getMarketplaceShowcaseProfile(): Promise<
  | { success: true; data: MarketplaceShowcaseData }
  | { success: false; error: string }
> {
  const professional = await getAuthProfessional();
  if (!professional) {
    return { success: false, error: "Não autenticado." };
  }

  if (professional.allowed) {
    await ensureShowcaseProfileForUser(professional.id);
  }

  const profile = await prisma.professionalProfile.findUnique({
    where: { userId: professional.id },
    select: profileSelect,
  });
  const inquiries = await loadShowcaseInquiries(profile?.id ?? null);
  const threads = await loadShowcaseThreads(profile?.id ?? null);

  return {
    success: true,
    data: toShowcaseData({
      professional,
      planAllowed: professional.allowed,
      profile,
      inquiries,
      threads,
    }),
  };
}

export async function saveMarketplaceShowcaseProfile(
  raw: unknown,
): Promise<
  | { success: true; data: MarketplaceShowcaseData }
  | { success: false; error: string; code?: "PLAN_REQUIRED" }
> {
  const parsed = showcaseSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error) };
  }

  const professional = await getAuthProfessional();
  if (!professional) {
    return { success: false, error: "Não autenticado." };
  }

  const rl = await enforceRateLimit(
    `marketplace-showcase:${professional.id}`,
    { maxRequests: 20, windowSeconds: 60 },
  );
  if (!rl.allowed) {
    return { success: false, error: `Muitas alterações. Tente em ${rl.resetIn}s.` };
  }

  const publicBio = parsed.data.publicBio
    ? sanitizeText(parsed.data.publicBio).slice(0, 1200)
    : null;
  const publicHeadline = parsed.data.publicHeadline
    ? sanitizeText(parsed.data.publicHeadline).slice(0, 160)
    : null;
  const mapsUrl = parsed.data.mapsUrl?.trim() || null;
  const officeAddress = parsed.data.officeAddress
    ? sanitizeText(parsed.data.officeAddress).slice(0, 500)
    : null;
  const city = parsed.data.city ? sanitizeText(parsed.data.city).slice(0, 80) : null;
  const neighborhood = parsed.data.neighborhood
    ? sanitizeText(parsed.data.neighborhood).slice(0, 80)
    : null;
  const state = parsed.data.state || null;
  const publicSpecialty = parsed.data.publicSpecialty
    ? sanitizeText(parsed.data.publicSpecialty).slice(0, 120)
    : null;
  const priceRaw = parsed.data.publicAveragePrice?.trim() ?? "";
  const publicAveragePrice = parseAveragePrice(priceRaw);
  if (priceRaw && publicAveragePrice == null) {
    return {
      success: false,
      error: "Informe a média de valores em reais, por exemplo 180,00.",
    };
  }
  const professionOption = professionOptions.find(
    (item) => item.value === parsed.data.profession,
  );
  if (!professionOption) {
    return { success: false, error: "Selecione uma profissão da lista." };
  }
  const student = !isShowcaseEligibleProfession(professionOption.value);
  const showcaseApproved = student ? false : parsed.data.showcaseApproved;
  const allowPatientAgendaBooking = student ? false : parsed.data.allowPatientAgendaBooking;
  const existingProfile = await prisma.professionalProfile.findUnique({
    where: { userId: professional.id },
    select: { showcaseApproved: true },
  });
  const turningOn =
    showcaseApproved && !existingProfile?.showcaseApproved;
  if (turningOn && !professional.allowed) {
    return {
      success: false,
      error: YIELD_MANAGEMENT_PLAN_ERROR,
      code: "PLAN_REQUIRED",
    };
  }
  const professionalName = sanitizeText(parsed.data.professionalName).slice(0, 160);
  if (professionalName.length < 2) {
    return { success: false, error: "Informe seu nome." };
  }

  try {
    const profile = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: professional.id },
        data: {
          officeAddress,
          name: professionalName,
          profession: professionOption.value,
          councilType: professionOption.council,
        },
      });

      return tx.professionalProfile.upsert({
        where: { userId: professional.id },
        create: {
          userId: professional.id,
          publicBio,
          publicHeadline,
          publicSpecialty,
          publicAveragePrice,
          showcaseApproved,
          allowPatientAgendaBooking,
          mapsUrl,
          city,
          neighborhood,
          state,
        },
        update: {
          publicBio,
          publicHeadline,
          publicSpecialty,
          publicAveragePrice,
          showcaseApproved,
          allowPatientAgendaBooking,
          mapsUrl,
          city,
          neighborhood,
          state,
        },
        select: profileSelect,
      });
    });

    if (officeAddress && officeAddress.length >= 5) {
      const point = await geocodeAddress(officeAddress);
      if (point) {
        await writeProfessionalLocation(profile.id, point);
      }
    }

    scheduleMarketplaceSlotSync(professional.id);
    revalidatePath("/dashboard/profile");
    revalidatePath("/buscar");
    revalidatePath("/vitrine");

    const inquiries = await loadShowcaseInquiries(profile.id);
    const threads = await loadShowcaseThreads(profile.id);
    return {
      success: true,
      data: toShowcaseData({
        professional: {
          ...professional,
          name: professionalName,
          profession: professionOption.value,
        },
        planAllowed: professional.allowed,
        profile,
        inquiries,
        threads,
        officeAddress,
      }),
    };
  } catch (error) {
    logger.error("Falha ao salvar vitrine do profissional", {
      feature: "marketplace-showcase",
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: "Não foi possível salvar a vitrine agora." };
  }
}

const photoMetaSchema = z.object({
  size: z.number().int().positive().max(2 * 1024 * 1024),
  type: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
});

export async function uploadMarketplacePublicPhoto(
  formData: FormData,
): Promise<
  | { success: true; publicPhotoUrl: string }
  | { success: false; error: string; code?: "PLAN_REQUIRED" }
> {
  const professional = await getAuthProfessional();
  if (!professional) {
    return { success: false, error: "Não autenticado." };
  }
  const rate = await enforceRateLimit(
    `marketplace-photo:${professional.email.toLowerCase()}`,
    PROFILE_LOGO_RATE_LIMIT,
  );
  if (!rate.allowed) {
    return { success: false, error: `Muitas alterações. Tente em ${rate.resetIn}s.` };
  }

  const file = formData.get("publicPhoto");
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: "Selecione uma imagem." };
  }
  const meta = photoMetaSchema.safeParse({ size: file.size, type: file.type });
  if (!meta.success) {
    return {
      success: false,
      error: "Arquivo inválido: use PNG, JPEG, WebP ou GIF de até 2 MB.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const safeName = file.name.replace(/[^\w.\-]/g, "_").slice(0, 80);
  const path = `marketplace/${professional.id}-${Date.now()}-${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage.from("images").upload(path, buffer, {
    contentType: file.type || "image/png",
    upsert: false,
  });
  if (uploadError) {
    return { success: false, error: `Erro ao enviar foto: ${uploadError.message}` };
  }

  const { data: publicData } = supabase.storage.from("images").getPublicUrl(path);
  const publicPhotoUrl = publicData.publicUrl;

  await prisma.professionalProfile.upsert({
    where: { userId: professional.id },
    create: {
      userId: professional.id,
      publicPhotoUrl,
    },
    update: { publicPhotoUrl },
  });

  revalidatePath("/dashboard/profile");
  revalidatePath("/buscar");
  revalidatePath("/vitrine");
  return { success: true, publicPhotoUrl };
}

export async function removeMarketplacePublicPhoto(): Promise<
  | { success: true }
  | { success: false; error: string; code?: "PLAN_REQUIRED" }
> {
  const professional = await getAuthProfessional();
  if (!professional) {
    return { success: false, error: "Não autenticado." };
  }
  await prisma.professionalProfile.updateMany({
    where: { userId: professional.id },
    data: { publicPhotoUrl: null },
  });
  revalidatePath("/dashboard/profile");
  revalidatePath("/buscar");
  revalidatePath("/vitrine");
  return { success: true };
}

const inquirySchema = z.object({
  profileId: z.string().trim().min(1).max(80),
  body: z.string().trim().min(10, "Escreva pelo menos 10 caracteres.").max(800),
});

/** Paciente logado envia mensagem ao profissional publicado na vitrine. */
export async function sendShowcaseInquiry(
  raw: unknown,
): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = inquirySchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error) };
  }

  const access = await requireB2cPatientContext();
  if (!access.ok) {
    return { success: false, error: "Entre na sua conta de paciente para enviar a mensagem." };
  }

  const rl = await enforceRateLimit(`showcase-inquiry:${access.ctx.patientId}`, {
    maxRequests: 8,
    windowSeconds: 3600,
  });
  if (!rl.allowed) {
    return { success: false, error: `Muitas mensagens. Tente em ${rl.resetIn}s.` };
  }

  const profile = await prisma.professionalProfile.findFirst({
    where: {
      id: parsed.data.profileId,
      showcaseApproved: true,
      user: { isBlocked: false },
    },
    select: {
      id: true,
      user: {
        select: {
          plan: true,
          email: true,
          isInfluencer: true,
          profession: true,
        },
      },
    },
  });
  if (!profile) {
    return { success: false, error: "Este profissional não está publicado na vitrine." };
  }

  const body = sanitizeText(parsed.data.body).slice(0, 800);
  if (body.trim().length < 10) {
    return { success: false, error: "Escreva pelo menos 10 caracteres." };
  }

  await prisma.showcaseMessage.create({
    data: {
      professionalProfileId: profile.id,
      patientId: access.ctx.patientId,
      author: "PATIENT",
      body,
    },
  });

  revalidatePath("/dashboard/profile");
  revalidatePath("/vitrine");
  return { success: true };
}

const replySchema = z.object({
  patientId: z.string().trim().min(1).max(80),
  body: z.string().trim().min(2, "Escreva a resposta.").max(800),
});

/** Profissional responde na conversa da vitrine. A marcação continua na agenda dele. */
export async function replyShowcaseConversation(
  raw: unknown,
): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = replySchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error) };
  }
  const professional = await getAuthProfessional();
  if (!professional) {
    return { success: false, error: "Não autenticado." };
  }
  const rl = await enforceRateLimit(`showcase-reply:${professional.id}`, {
    maxRequests: 30,
    windowSeconds: 3600,
  });
  if (!rl.allowed) {
    return { success: false, error: `Muitas respostas. Tente em ${rl.resetIn}s.` };
  }

  const profile = await prisma.professionalProfile.findUnique({
    where: { userId: professional.id },
    select: { id: true },
  });
  if (!profile) {
    return { success: false, error: "Publique o card da vitrine antes de responder." };
  }

  const known = await prisma.showcaseMessage.findFirst({
    where: { professionalProfileId: profile.id, patientId: parsed.data.patientId },
    select: { id: true },
  });
  const legacy = known
    ? null
    : await prisma.showcaseInquiry.findFirst({
        where: { professionalProfileId: profile.id, patientId: parsed.data.patientId },
        select: { id: true },
      });
  if (!known && !legacy) {
    return { success: false, error: "Esta conversa não existe." };
  }

  const body = sanitizeText(parsed.data.body).slice(0, 800);
  if (body.trim().length < 2) {
    return { success: false, error: "Escreva a resposta." };
  }

  await prisma.showcaseMessage.create({
    data: {
      professionalProfileId: profile.id,
      patientId: parsed.data.patientId,
      author: "PROFESSIONAL",
      body,
    },
  });
  revalidatePath("/dashboard/profile");
  revalidatePath("/vitrine");
  return { success: true };
}

export async function getShowcaseConversation(
  profileId: string,
): Promise<
  | { success: true; messages: ShowcaseChatMessage[]; bookings: ShowcaseDualBookingView[] }
  | { success: false; error: string }
> {
  const access = await requireB2cPatientContext();
  if (!access.ok) {
    return { success: false, error: "Entre na sua conta de paciente." };
  }
  const profile = await prisma.professionalProfile.findFirst({
    where: { id: profileId, showcaseApproved: true, user: { isBlocked: false } },
    select: { id: true },
  });
  if (!profile) {
    return { success: false, error: "Este profissional não está publicado na vitrine." };
  }

  const [messages, inquiries, bookings] = await Promise.all([
    prisma.showcaseMessage.findMany({
      where: { professionalProfileId: profile.id, patientId: access.ctx.patientId },
      orderBy: { createdAt: "asc" },
      take: 80,
      select: { id: true, author: true, body: true, createdAt: true },
    }),
    prisma.showcaseInquiry.findMany({
      where: { professionalProfileId: profile.id, patientId: access.ctx.patientId },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: { id: true, body: true, createdAt: true },
    }),
    prisma.showcaseDualBooking.findMany({
      where: {
        professionalProfileId: profile.id,
        b2cPatientId: access.ctx.patientId,
      },
      orderBy: { startAt: "desc" },
      take: 12,
      select: { id: true, startAt: true, status: true },
    }),
  ]);

  const merged: ShowcaseChatMessage[] = [
    ...inquiries.map((row) => ({
      id: `inquiry-${row.id}`,
      author: "PATIENT" as const,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
    })),
    ...messages.map((row) => ({
      id: row.id,
      author: row.author,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
    })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return {
    success: true,
    messages: merged,
    bookings: bookings.map((row) => ({
      id: row.id,
      startAt: row.startAt.toISOString(),
      status: row.status,
    })),
  };
}
