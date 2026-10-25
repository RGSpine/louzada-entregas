"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import { firstZodError } from "@/lib/marketplace/schemas";
import { requireB2cPatientContext } from "@/lib/b2c/patient-session";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  clearActiveHealthProfileCookie,
  writeActiveHealthProfileCookie,
} from "@/lib/b2c/active-profile-server";
import { logoutAction } from "@/app/actions/auth";
import {
  addHealthJournalEntrySchema,
  B2C_HEALTH_JOURNAL_RATE_LIMIT,
  updateHealthConsultationReviewSchema,
  updateHealthJournalEntrySchema,
  updateHealthPanoramaSchema,
  createHealthProfileSchema,
  updateHealthCareProfileSchema,
  MAX_HEALTH_PROFILES_PER_ACCOUNT,
  setActiveHealthProfileSchema,
  saveDailyHealthCheckSchema,
  setHealthShareSchema,
  toggleHealthTaskSchema,
  updateB2cPatientProfileSchema,
} from "@/lib/b2c/schemas";
import {
  healthDayDate,
  healthDayKey,
  toDailyHealthCheckView,
  type DailyHealthCheckView,
} from "@/lib/b2c/daily-health";
import {
  listHealthJournal,
  type HealthJournalEntryView,
} from "@/lib/b2c/health-journal";
import {
  buildCareTimeline,
  listHealthShareCandidates,
  type CareTimelineEvent,
  type HealthShareCandidate,
} from "@/lib/b2c/care-timeline";
import {
  listHealthChatMessages,
  type HealthChatMessageView,
} from "@/lib/b2c/health-chat";
import type { PatientMapSectionSlug } from "@/lib/b2c/patient-map-sections";
import {
  parseConsultationReviewMeta,
  parseStoredConsultationStructured,
} from "@/lib/b2c/consultation-structured";
import {
  buildPatientConsultationReview,
  buildPatientPanoramaReview,
  readPanoramaReview,
} from "@/lib/b2c/patient-clinical-review";

export type HealthMapProfileView = {
  id: string;
  name: string;
  relationship: string | null;
  dateOfBirth: string | null;
  isPrimary: boolean;
};

export type HealthMapConsultationView = {
  id: string;
  createdAt: string;
  sourceType: string | null;
  translatedExplanation: string;
  professionalName: string | null;
  specialty: string | null;
  recommendations: string[];
  attentionPoints: string[];
  orientations: string[];
};

export type HealthMapAppointmentView = {
  id: string;
  datetime: string;
  endAt: string;
  professionalName: string;
  specialty: string | null;
  headline: string | null;
  yieldActive: boolean;
  discountPrice: string | null;
  basePrice: string;
  dualBookingId?: string | null;
  linkStatus?: "PENDING" | "CONFIRMED" | "CANCELLED" | null;
};

export type HealthMapSnapshot = {
  profileComplete: boolean;
  patient: {
    name: string;
    email: string | null;
    phone: string | null;
    dateOfBirth: string | null;
  };
  healthProfileId: string;
  activeProfile: HealthMapProfileView;
  profiles: HealthMapProfileView[];
  healthPanorama: string | null;
  tasks: Array<{
    id: string;
    title: string;
    type: string;
    isCompleted: boolean;
    scheduledTime: string | null;
  }>;
  consultations: HealthMapConsultationView[];
  upcomingAppointments: HealthMapAppointmentView[];
  pastAppointments: HealthMapAppointmentView[];
  todayCheck: DailyHealthCheckView | null;
  recentDailyChecks: DailyHealthCheckView[];
  journalEntries: HealthJournalEntryView[];
  careTimeline: CareTimelineEvent[];
  shareCandidates: HealthShareCandidate[];
  /** @deprecated use consultations */
  summaries: Array<{
    id: string;
    translatedExplanation: string;
    sourceType: string | null;
    createdAt: string;
  }>;
};

function toProfileView(profile: {
  id: string;
  name: string;
  relationship: string | null;
  dateOfBirth: Date | null;
  isPrimary: boolean;
}): HealthMapProfileView {
  return {
    id: profile.id,
    name: profile.name,
    relationship: profile.relationship,
    dateOfBirth: profile.dateOfBirth
      ? profile.dateOfBirth.toISOString().slice(0, 10)
      : null,
    isPrimary: profile.isPrimary,
  };
}

export async function getHealthMapSnapshot(
  focus?: PatientMapSectionSlug,
): Promise<
  | { success: true; data: HealthMapSnapshot }
  | { success: false; error: string }
> {
  const auth = await requireB2cPatientContext();
  if (!auth.ok) return { success: false, error: auth.error };

  const now = new Date();
  const slotSelect = {
    id: true,
    datetime: true,
    endAt: true,
    yieldActive: true,
    discountPrice: true,
    basePrice: true,
    professional: {
      select: {
        publicHeadline: true,
        user: { select: { name: true, profession: true } },
        specialties: {
          take: 2,
          select: { specialty: { select: { name: true } } },
        },
      },
    },
  } as const;

  // Cada página lê só o que mostra. connection_limit=1: leituras seguem em série.
  const needsTasks = !focus || focus === "estado" || focus === "agenda";
  const needsSummaries = !focus || focus === "consultas";
  const needsPanorama = !focus || focus === "estado";
  const needsSlots = !focus || focus === "agenda";
  const needsDaily = !focus || focus === "hoje";
  const needsJournal = !focus || focus === "relato";
  const needsTimeline = !focus || focus === "linha";

  const tasks = needsTasks
    ? await prisma.healthTask.findMany({
    where: { healthProfileId: auth.ctx.healthProfileId },
    orderBy: [
      { isCompleted: "asc" },
      { scheduledTime: "asc" },
      { createdAt: "desc" },
    ],
    take: 40,
    select: {
      id: true,
      title: true,
      type: true,
      isCompleted: true,
      scheduledTime: true,
    },
  })
    : [];
  const summaries = needsSummaries
    ? await prisma.clinicalSummary.findMany({
    where: { healthProfileId: auth.ctx.healthProfileId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      translatedExplanation: true,
      sourceType: true,
      createdAt: true,
      structured: true,
    },
  })
    : [];
  const profileRow = needsPanorama
    ? await prisma.healthProfile.findUnique({
        where: { id: auth.ctx.healthProfileId },
        select: { healthPanorama: true },
      })
    : null;
  const upcomingSlots = needsSlots
    ? await prisma.scheduleSlot.findMany({
    where: {
      patientId: auth.ctx.patientId,
      status: "BOOKED",
      datetime: { gte: now },
    },
    orderBy: { datetime: "asc" },
    take: 12,
    select: slotSelect,
  })
    : [];
  const pastSlots = needsSlots
    ? await prisma.scheduleSlot.findMany({
    where: {
      patientId: auth.ctx.patientId,
      status: "BOOKED",
      datetime: { lt: now },
    },
    orderBy: { datetime: "desc" },
    take: 12,
    select: slotSelect,
  })
    : [];
  const dailyChecks = needsDaily
    ? await prisma.dailyHealthCheck.findMany({
    where: { healthProfileId: auth.ctx.healthProfileId },
    orderBy: { day: "desc" },
    take: 7,
    select: {
      day: true,
      waterMl: true,
      sleepMinutes: true,
      sleepQuality: true,
      urineColor: true,
      bristolType: true,
      stoolColor: true,
      activityMinutes: true,
      wearableSource: true,
      wearableSteps: true,
      wearableSleepMinutes: true,
      wearableActiveMinutes: true,
      wearableSyncedAt: true,
    },
  })
    : [];
  const journalEntries = needsJournal
    ? await listHealthJournal(auth.ctx.healthProfileId, 30)
    : [];
  const careTimeline = needsTimeline
    ? await buildCareTimeline(auth.ctx.healthProfileId, 40)
    : [];
  const shareCandidates = needsTimeline
    ? await listHealthShareCandidates({
        patientId: auth.ctx.patientId,
        healthProfileId: auth.ctx.healthProfileId,
      })
    : [];

  const consultations: HealthMapConsultationView[] = summaries.map((summary) => {
    const structured = parseStoredConsultationStructured(summary.structured);
    return {
      id: summary.id,
      createdAt: summary.createdAt.toISOString(),
      sourceType: summary.sourceType,
      translatedExplanation: summary.translatedExplanation,
      professionalName: structured.professionalName,
      specialty: structured.specialty,
      recommendations: structured.recommendations,
      attentionPoints: structured.attentionPoints,
      orientations: structured.orientations,
    };
  });

  function mapSlotToAppointment(slot: (typeof upcomingSlots)[number]): HealthMapAppointmentView {
    const specialtyFromCatalog =
      slot.professional.specialties[0]?.specialty.name ?? null;
    return {
      id: slot.id,
      datetime: slot.datetime.toISOString(),
      endAt: slot.endAt.toISOString(),
      professionalName: slot.professional.user.name?.trim() || "Profissional",
      specialty:
        specialtyFromCatalog ||
        slot.professional.user.profession?.trim() ||
        null,
      headline: slot.professional.publicHeadline,
      yieldActive: slot.yieldActive,
      discountPrice: slot.discountPrice?.toString() ?? null,
      basePrice: slot.basePrice.toString(),
    };
  }

  const dualRows = needsSlots
    ? await prisma.showcaseDualBooking.findMany({
    where: {
      b2cPatientId: auth.ctx.patientId,
      healthProfileId: auth.ctx.healthProfileId,
    },
    orderBy: { startAt: "desc" },
    take: 20,
    select: {
      id: true,
      startAt: true,
      endAt: true,
      status: true,
      professionalProfile: {
        select: {
          publicHeadline: true,
          publicSpecialty: true,
          user: { select: { name: true, profession: true } },
        },
      },
    },
  })
    : [];
  const dualViews: HealthMapAppointmentView[] = dualRows.map((row) => ({
    id: `dual-${row.id}`,
    datetime: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    professionalName: row.professionalProfile.user.name?.trim() || "Profissional",
    specialty:
      row.professionalProfile.publicSpecialty?.trim() ||
      row.professionalProfile.user.profession?.trim() ||
      null,
    headline: row.professionalProfile.publicHeadline,
    yieldActive: false,
    discountPrice: null,
    basePrice: "",
    dualBookingId: row.id,
    linkStatus: row.status,
  }));
  const upcomingAppointments = [
    ...upcomingSlots.map(mapSlotToAppointment),
    ...dualViews.filter(
      (row) => row.linkStatus !== "CANCELLED" && new Date(row.datetime).getTime() >= now.getTime(),
    ),
  ].sort((a, b) => a.datetime.localeCompare(b.datetime));
  const pastAppointments = [
    ...pastSlots.map(mapSlotToAppointment),
    ...dualViews.filter(
      (row) => row.linkStatus === "CANCELLED" || new Date(row.datetime).getTime() < now.getTime(),
    ),
  ].sort((a, b) => b.datetime.localeCompare(a.datetime));
  const recentDailyChecks = dailyChecks.map(toDailyHealthCheckView);
  const todayKey = healthDayKey();
  const todayCheck =
    recentDailyChecks.find((item) => item.day === todayKey) ?? null;

  return {
    success: true,
    data: {
      profileComplete: auth.ctx.profileComplete,
      patient: {
        name: auth.ctx.patientName,
        email: auth.ctx.email,
        phone: auth.ctx.phone,
        dateOfBirth: auth.ctx.dateOfBirth
          ? auth.ctx.dateOfBirth.toISOString().slice(0, 10)
          : null,
      },
      healthProfileId: auth.ctx.healthProfileId,
      activeProfile: toProfileView(auth.ctx.activeProfile),
      profiles: auth.ctx.profiles.map(toProfileView),
      healthPanorama: profileRow?.healthPanorama ?? null,
      tasks: tasks.map((task) => ({
        id: task.id,
        title: task.title,
        type: task.type,
        isCompleted: task.isCompleted,
        scheduledTime: task.scheduledTime?.toISOString() ?? null,
      })),
      consultations,
      upcomingAppointments,
      pastAppointments,
      todayCheck,
      recentDailyChecks,
      journalEntries,
      careTimeline,
      shareCandidates,
      summaries: consultations.map((item) => ({
        id: item.id,
        translatedExplanation: item.translatedExplanation,
        sourceType: item.sourceType,
        createdAt: item.createdAt,
      })),
    },
  };
}

export async function getPatientMapHome(): Promise<
  | {
      success: true;
      data: {
        firstName: string;
        activeProfileName: string;
        relationship: string | null;
        profileComplete: boolean;
      };
    }
  | { success: false; error: string }
> {
  const auth = await requireB2cPatientContext();
  if (!auth.ok) return { success: false, error: auth.error };
  const active = toProfileView(auth.ctx.activeProfile);
  const firstName =
    active.name.split(" ")[0] || auth.ctx.patientName.split(" ")[0] || "paciente";
  return {
    success: true,
    data: {
      firstName,
      activeProfileName: active.name,
      relationship: active.relationship,
      profileComplete: auth.ctx.profileComplete,
    },
  };
}

export async function setActiveHealthProfile(
  raw: unknown,
): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = setActiveHealthProfileSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error) };
  }

  const auth = await requireB2cPatientContext({
    healthProfileId: parsed.data.healthProfileId,
  });
  if (!auth.ok) return { success: false, error: auth.error };

  await writeActiveHealthProfileCookie(parsed.data.healthProfileId);
  revalidatePath("/mapa-saude", "layout");
  return { success: true };
}

function careDateOrNull(value: string | undefined): Date | null | "invalid" {
  if (!value) return null;
  const birth = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(birth.getTime()) || birth.getTime() > Date.now()) return "invalid";
  return birth;
}

export async function createHealthProfile(
  raw: unknown,
): Promise<
  | { success: true; healthProfileId: string }
  | { success: false; error: string }
> {
  const parsed = createHealthProfileSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error) };
  }

  const auth = await requireB2cPatientContext();
  if (!auth.ok) return { success: false, error: auth.error };

  if (auth.ctx.profiles.length >= MAX_HEALTH_PROFILES_PER_ACCOUNT) {
    return {
      success: false,
      error: `Limite de ${MAX_HEALTH_PROFILES_PER_ACCOUNT} perfis por conta.`,
    };
  }

  const dateOfBirth = careDateOrNull(parsed.data.dateOfBirth);
  if (dateOfBirth === "invalid") {
    return { success: false, error: "Data de nascimento inválida." };
  }

  const created = await prisma.healthProfile.create({
    data: {
      patientId: auth.ctx.patientId,
      name: sanitizeText(parsed.data.name).slice(0, 200),
      relationship: parsed.data.relationship,
      dateOfBirth,
      phone: parsed.data.phone ?? null,
      insuranceName: parsed.data.insuranceName || null,
      treatments: parsed.data.treatments || null,
      profileNotes: parsed.data.profileNotes || null,
      isPrimary: false,
    },
    select: { id: true },
  });

  await writeActiveHealthProfileCookie(created.id);
  revalidatePath("/mapa-saude", "layout");
  return { success: true, healthProfileId: created.id };
}

export async function updateB2cPatientProfile(
  raw: unknown,
): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = updateB2cPatientProfileSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error) };
  }

  const auth = await requireB2cPatientContext();
  if (!auth.ok) return { success: false, error: auth.error };

  const birth = new Date(`${parsed.data.dateOfBirth}T12:00:00.000Z`);
  if (Number.isNaN(birth.getTime()) || birth.getTime() > Date.now()) {
    return { success: false, error: "Data de nascimento inválida." };
  }

  const name = sanitizeText(parsed.data.name).slice(0, 200);
  const primaryId =
    auth.ctx.profiles.find((profile) => profile.isPrimary)?.id ??
    auth.ctx.healthProfileId;

  await prisma.$transaction([
    prisma.patient.update({
      where: { id: auth.ctx.patientId },
      data: {
        name,
        phone: parsed.data.phone,
        dateOfBirth: birth,
      },
    }),
    prisma.healthProfile.update({
      where: { id: primaryId },
      data: {
        name,
        dateOfBirth: birth,
        relationship: "self",
        isPrimary: true,
      },
    }),
  ]);

  revalidatePath("/mapa-saude", "layout");
  return { success: true };
}

export type HealthCareProfileView = HealthMapProfileView & {
  phone: string | null;
  insuranceName: string | null;
  treatments: string;
  profileNotes: string;
};

export async function getHealthCareProfiles(): Promise<
  | {
      success: true;
      data: {
        email: string | null;
        activeProfileId: string;
        profiles: HealthCareProfileView[];
      };
    }
  | { success: false; error: string }
> {
  const auth = await requireB2cPatientContext();
  if (!auth.ok) return { success: false, error: auth.error };

  const rows = await prisma.healthProfile.findMany({
    where: { patientId: auth.ctx.patientId },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      relationship: true,
      dateOfBirth: true,
      isPrimary: true,
      phone: true,
      insuranceName: true,
      treatments: true,
      profileNotes: true,
    },
  });

  return {
    success: true,
    data: {
      email: auth.ctx.email,
      activeProfileId: auth.ctx.healthProfileId,
      profiles: rows.map((row) => ({
        ...toProfileView({
          ...row,
          dateOfBirth:
            row.dateOfBirth ?? (row.isPrimary ? auth.ctx.dateOfBirth : null),
        }),
        phone: row.phone ?? (row.isPrimary ? auth.ctx.phone : null),
        insuranceName: row.insuranceName,
        treatments: row.treatments ?? "",
        profileNotes: row.profileNotes ?? "",
      })),
    },
  };
}

export async function updateHealthCareProfile(
  raw: unknown,
): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = updateHealthCareProfileSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error) };
  }

  const auth = await requireB2cPatientContext({
    healthProfileId: parsed.data.healthProfileId,
  });
  if (!auth.ok) return { success: false, error: auth.error };

  const current = auth.ctx.profiles.find(
    (profile) => profile.id === parsed.data.healthProfileId,
  );
  if (!current) {
    return { success: false, error: "Perfil de saúde não encontrado nesta conta." };
  }

  const dateOfBirth = careDateOrNull(parsed.data.dateOfBirth);
  if (dateOfBirth === "invalid") {
    return { success: false, error: "Data de nascimento inválida." };
  }

  const name = sanitizeText(parsed.data.name).slice(0, 200);
  const relationship = current.isPrimary
    ? "self"
    : parsed.data.relationship && parsed.data.relationship !== "self"
      ? parsed.data.relationship
      : current.relationship ?? "other";

  await prisma.healthProfile.update({
    where: { id: current.id },
    data: {
      name,
      relationship,
      dateOfBirth,
      phone: parsed.data.phone ?? null,
      insuranceName: parsed.data.insuranceName || null,
      treatments: parsed.data.treatments || null,
      profileNotes: parsed.data.profileNotes || null,
      isPrimary: current.isPrimary,
    },
  });

  if (current.isPrimary) {
    await prisma.patient.update({
      where: { id: auth.ctx.patientId },
      data: {
        name,
        phone: parsed.data.phone ?? null,
        dateOfBirth,
      },
    });
  }

  revalidatePath("/mapa-saude", "layout");
  return { success: true };
}

export async function toggleHealthTask(
  raw: unknown,
): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = toggleHealthTaskSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error) };
  }

  const auth = await requireB2cPatientContext({
    healthProfileId: parsed.data.healthProfileId,
  });
  if (!auth.ok) return { success: false, error: auth.error };

  const task = await prisma.healthTask.findFirst({
    where: {
      id: parsed.data.taskId,
      healthProfileId: auth.ctx.healthProfileId,
    },
    select: { id: true },
  });
  if (!task) return { success: false, error: "Tarefa não encontrada." };

  await prisma.healthTask.update({
    where: { id: task.id },
    data: { isCompleted: parsed.data.isCompleted },
  });
  revalidatePath("/mapa-saude", "layout");
  return { success: true };
}

export async function getPatientHealthChatMessages(raw?: unknown): Promise<
  | { success: true; messages: HealthChatMessageView[] }
  | { success: false; error: string }
> {
  const healthProfileId =
    typeof raw === "object" &&
    raw &&
    "healthProfileId" in raw &&
    typeof (raw as { healthProfileId?: unknown }).healthProfileId === "string"
      ? (raw as { healthProfileId: string }).healthProfileId
      : undefined;

  const auth = await requireB2cPatientContext({ healthProfileId });
  if (!auth.ok) return { success: false, error: auth.error };
  const messages = await listHealthChatMessages(auth.ctx.healthProfileId);
  return { success: true, messages };
}

export async function saveDailyHealthCheck(
  raw: unknown,
): Promise<
  | { success: true; check: DailyHealthCheckView }
  | { success: false; error: string }
> {
  const parsed = saveDailyHealthCheckSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error) };
  }

  const auth = await requireB2cPatientContext({
    healthProfileId: parsed.data.healthProfileId,
  });
  if (!auth.ok) return { success: false, error: auth.error };

  const dayKey = parsed.data.day ?? healthDayKey();
  if (dayKey !== healthDayKey()) {
    return { success: false, error: "O check-in diário vale para o dia de hoje." };
  }

  const manual = {
    waterMl: parsed.data.waterMl ?? null,
    sleepMinutes: parsed.data.sleepMinutes ?? null,
    sleepQuality: parsed.data.sleepQuality ?? null,
    urineColor: parsed.data.urineColor ?? null,
    bristolType: parsed.data.bristolType ?? null,
    stoolColor: parsed.data.stoolColor ?? null,
    activityMinutes: parsed.data.activityMinutes ?? null,
  };

  const saved = await prisma.dailyHealthCheck.upsert({
    where: {
      healthProfileId_day: {
        healthProfileId: auth.ctx.healthProfileId,
        day: healthDayDate(dayKey),
      },
    },
    create: {
      healthProfileId: auth.ctx.healthProfileId,
      day: healthDayDate(dayKey),
      ...manual,
    },
    update: manual,
    select: {
      day: true,
      waterMl: true,
      sleepMinutes: true,
      sleepQuality: true,
      urineColor: true,
      bristolType: true,
      stoolColor: true,
      activityMinutes: true,
      wearableSource: true,
      wearableSteps: true,
      wearableSleepMinutes: true,
      wearableActiveMinutes: true,
      wearableSyncedAt: true,
    },
  });

  revalidatePath("/mapa-saude", "layout");
  return { success: true, check: toDailyHealthCheckView(saved) };
}

export async function setHealthShare(
  raw: unknown,
): Promise<
  | { success: true; candidates: HealthShareCandidate[] }
  | { success: false; error: string }
> {
  const parsed = setHealthShareSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error) };
  }

  const auth = await requireB2cPatientContext({
    healthProfileId: parsed.data.healthProfileId,
  });
  if (!auth.ok) return { success: false, error: auth.error };

  const candidates = await listHealthShareCandidates({
    patientId: auth.ctx.patientId,
    healthProfileId: auth.ctx.healthProfileId,
  });
  const allowed = candidates.some(
    (item) => item.professionalProfileId === parsed.data.professionalProfileId,
  );
  if (!allowed) {
    return {
      success: false,
      error: "Só é possível compartilhar com um profissional com quem você tem consulta.",
    };
  }

  if (parsed.data.shared) {
    await prisma.healthShareGrant.upsert({
      where: {
        healthProfileId_professionalProfileId: {
          healthProfileId: auth.ctx.healthProfileId,
          professionalProfileId: parsed.data.professionalProfileId,
        },
      },
      create: {
        healthProfileId: auth.ctx.healthProfileId,
        professionalProfileId: parsed.data.professionalProfileId,
      },
      update: {},
    });
  } else {
    await prisma.healthShareGrant.deleteMany({
      where: {
        healthProfileId: auth.ctx.healthProfileId,
        professionalProfileId: parsed.data.professionalProfileId,
      },
    });
  }

  revalidatePath("/mapa-saude", "layout");
  return {
    success: true,
    candidates: await listHealthShareCandidates({
      patientId: auth.ctx.patientId,
      healthProfileId: auth.ctx.healthProfileId,
    }),
  };
}

export async function addHealthJournalEntry(
  raw: unknown,
): Promise<
  | { success: true; entries: HealthJournalEntryView[] }
  | { success: false; error: string }
> {
  const parsed = addHealthJournalEntrySchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error) };
  }

  const auth = await requireB2cPatientContext({
    healthProfileId: parsed.data.healthProfileId,
  });
  if (!auth.ok) return { success: false, error: auth.error };

  const rl = await enforceRateLimit(
    `b2c-journal:${auth.ctx.authUserId}`,
    B2C_HEALTH_JOURNAL_RATE_LIMIT,
  );
  if (!rl.allowed) {
    return { success: false, error: `Tente em ${rl.resetIn}s.` };
  }

  await prisma.healthJournalEntry.create({
    data: {
      healthProfileId: auth.ctx.healthProfileId,
      body: parsed.data.body,
      source: "text",
    },
  });

  revalidatePath("/mapa-saude", "layout");
  const entries = await listHealthJournal(auth.ctx.healthProfileId, 30);
  return { success: true, entries };
}

export async function updateHealthJournalEntry(
  raw: unknown,
): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = updateHealthJournalEntrySchema.safeParse(raw);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const auth = await requireB2cPatientContext({
    healthProfileId: parsed.data.healthProfileId,
  });
  if (!auth.ok) return { success: false, error: auth.error };

  const rl = await enforceRateLimit(
    `b2c-journal-edit:${auth.ctx.authUserId}`,
    B2C_HEALTH_JOURNAL_RATE_LIMIT,
  );
  if (!rl.allowed) return { success: false, error: `Tente em ${rl.resetIn}s.` };

  const entry = await prisma.healthJournalEntry.findFirst({
    where: { id: parsed.data.entryId, healthProfileId: auth.ctx.healthProfileId },
    select: { id: true },
  });
  if (!entry) return { success: false, error: "Relato não encontrado." };

  await prisma.healthJournalEntry.update({
    where: { id: entry.id },
    data: { body: parsed.data.body },
  });
  revalidatePath("/mapa-saude", "layout");
  return { success: true };
}

export async function updateHealthConsultationReview(
  raw: unknown,
): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = updateHealthConsultationReviewSchema.safeParse(raw);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const auth = await requireB2cPatientContext({
    healthProfileId: parsed.data.healthProfileId,
  });
  if (!auth.ok) return { success: false, error: auth.error };

  const rl = await enforceRateLimit(
    `b2c-consult-edit:${auth.ctx.authUserId}`,
    B2C_HEALTH_JOURNAL_RATE_LIMIT,
  );
  if (!rl.allowed) return { success: false, error: `Tente em ${rl.resetIn}s.` };

  const summary = await prisma.clinicalSummary.findFirst({
    where: { id: parsed.data.summaryId, healthProfileId: auth.ctx.healthProfileId },
    select: { id: true, structured: true },
  });
  if (!summary) return { success: false, error: "Consulta não encontrada." };

  const previous = parseStoredConsultationStructured(summary.structured);
  const { explanation, structured } = buildPatientConsultationReview({
    previous,
    previousRejected: parseConsultationReviewMeta(summary.structured).rejected,
    nextExplanation: parsed.data.explanation,
    nextRecommendations: parsed.data.recommendations,
    nextAttentionPoints: parsed.data.attentionPoints,
    nextOrientations: parsed.data.orientations,
    nextProfessionalName: parsed.data.professionalName ?? "",
    nextSpecialty: parsed.data.specialty ?? "",
    panoramaReview: readPanoramaReview(summary.structured),
    editedAt: new Date(),
  });

  await prisma.clinicalSummary.update({
    where: { id: summary.id },
    data: {
      translatedExplanation: explanation,
      structured: JSON.parse(JSON.stringify(structured)),
    },
  });
  revalidatePath("/mapa-saude", "layout");
  return { success: true };
}

export async function updateHealthPanoramaReview(
  raw: unknown,
): Promise<{ success: true; panorama: string } | { success: false; error: string }> {
  const parsed = updateHealthPanoramaSchema.safeParse(raw);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const auth = await requireB2cPatientContext({
    healthProfileId: parsed.data.healthProfileId,
  });
  if (!auth.ok) return { success: false, error: auth.error };

  const rl = await enforceRateLimit(
    `b2c-panorama-edit:${auth.ctx.authUserId}`,
    B2C_HEALTH_JOURNAL_RATE_LIMIT,
  );
  if (!rl.allowed) return { success: false, error: `Tente em ${rl.resetIn}s.` };

  const profile = await prisma.healthProfile.findFirst({
    where: { id: auth.ctx.healthProfileId },
    select: { id: true, healthPanorama: true },
  });
  if (!profile) return { success: false, error: "Perfil não encontrado." };

  const latest = await prisma.clinicalSummary.findFirst({
    where: { healthProfileId: profile.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, structured: true },
  });
  const { panorama, review } = buildPatientPanoramaReview({
    previousPanorama: profile.healthPanorama ?? "",
    previousRejected: readPanoramaReview(latest?.structured).rejected,
    nextPanorama: parsed.data.panorama,
    editedAt: new Date(),
  });

  await prisma.healthProfile.update({
    where: { id: profile.id },
    data: { healthPanorama: panorama || null },
  });
  if (latest) {
    const structured = parseStoredConsultationStructured(latest.structured);
    await prisma.clinicalSummary.update({
      where: { id: latest.id },
      data: {
        structured: JSON.parse(JSON.stringify({ ...structured, panoramaReview: review })),
      },
    });
  }

  revalidatePath("/mapa-saude", "layout");
  return { success: true, panorama };
}

/** Logout do paciente B2C → limpa sessão + cookie de perfil e libera o gateway `/`. */
export async function logoutB2cPatientAction(): Promise<
  { success: true } | { success: false; error: string }
> {
  try {
    await clearActiveHealthProfileCookie();
  } catch {
    // cookie opcional
  }
  const result = await logoutAction();
  if (!result.success) {
    return { success: false, error: result.error ?? "Não foi possível sair." };
  }
  return { success: true };
}
