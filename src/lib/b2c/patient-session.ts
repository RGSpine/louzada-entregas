import type { User as AuthUser } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { sanitizeText } from "@/lib/sanitize";
import { readActiveHealthProfileCookie } from "@/lib/b2c/active-profile-server";

export type B2cHealthProfileSummary = {
  id: string;
  name: string;
  relationship: string | null;
  dateOfBirth: Date | null;
  isPrimary: boolean;
};

export type B2cPatientContext = {
  authUserId: string;
  email: string | null;
  patientId: string;
  patientName: string;
  phone: string | null;
  dateOfBirth: Date | null;
  healthProfileId: string;
  activeProfile: B2cHealthProfileSummary;
  profiles: B2cHealthProfileSummary[];
  profileComplete: boolean;
};

function metadataName(authUser: AuthUser): string {
  const metadata = authUser.user_metadata ?? {};
  const raw =
    (typeof metadata.full_name === "string" && metadata.full_name) ||
    (typeof metadata.name === "string" && metadata.name) ||
    authUser.email?.split("@")[0] ||
    "Paciente";
  return sanitizeText(raw).slice(0, 200) || "Paciente";
}

async function ensurePrimaryProfile(patient: {
  id: string;
  name: string;
  dateOfBirth: Date | null;
}): Promise<B2cHealthProfileSummary> {
  let profile = await prisma.healthProfile.findFirst({
    where: { patientId: patient.id, isPrimary: true },
    select: {
      id: true,
      name: true,
      relationship: true,
      dateOfBirth: true,
      isPrimary: true,
    },
    orderBy: { createdAt: "asc" },
  });

  if (!profile) {
    const anyProfile = await prisma.healthProfile.findFirst({
      where: { patientId: patient.id },
      select: {
        id: true,
        name: true,
        relationship: true,
        dateOfBirth: true,
        isPrimary: true,
      },
      orderBy: { createdAt: "asc" },
    });
    if (anyProfile) {
      profile = await prisma.healthProfile.update({
        where: { id: anyProfile.id },
        data: { isPrimary: true },
        select: {
          id: true,
          name: true,
          relationship: true,
          dateOfBirth: true,
          isPrimary: true,
        },
      });
    } else {
      profile = await prisma.healthProfile.create({
        data: {
          patientId: patient.id,
          name: patient.name,
          relationship: "self",
          dateOfBirth: patient.dateOfBirth,
          isPrimary: true,
        },
        select: {
          id: true,
          name: true,
          relationship: true,
          dateOfBirth: true,
          isPrimary: true,
        },
      });
    }
  }

  return profile;
}

/**
 * Garante Patient B2C + HealthProfile primário e resolve o perfil ativo
 * (cookie ou titular).
 */
export async function ensureB2cPatientAndPrimaryProfile(
  authUser: AuthUser,
  preferredProfileId?: string | null,
): Promise<B2cPatientContext> {
  const name = metadataName(authUser);
  const email = authUser.email?.toLowerCase() ?? null;

  let patient = await prisma.patient.findUnique({
    where: { authUserId: authUser.id },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      dateOfBirth: true,
    },
  });

  if (!patient) {
    try {
      patient = await prisma.patient.create({
        data: {
          authUserId: authUser.id,
          name,
          email,
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          dateOfBirth: true,
        },
      });
    } catch {
      patient = await prisma.patient.findUnique({
        where: { authUserId: authUser.id },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          dateOfBirth: true,
        },
      });
      if (!patient) throw new Error("Falha ao criar perfil de paciente.");
    }
  }

  const primary = await ensurePrimaryProfile(patient);
  const profiles = await prisma.healthProfile.findMany({
    where: { patientId: patient.id },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      relationship: true,
      dateOfBirth: true,
      isPrimary: true,
    },
  });

  const cookieId =
    preferredProfileId?.trim() || (await readActiveHealthProfileCookie());
  const active =
    profiles.find((profile) => profile.id === cookieId) ??
    profiles.find((profile) => profile.isPrimary) ??
    primary;

  const profileComplete = Boolean(
    patient.phone?.trim() && patient.dateOfBirth,
  );

  return {
    authUserId: authUser.id,
    email: patient.email ?? email,
    patientId: patient.id,
    patientName: patient.name,
    phone: patient.phone,
    dateOfBirth: patient.dateOfBirth,
    healthProfileId: active.id,
    activeProfile: active,
    profiles,
    profileComplete,
  };
}

/**
 * Paciente marketplace já existente. Não cria ficha: um login profissional
 * que só abre a vitrine continua como visitante.
 */
export async function getExistingB2cPatientViewer(): Promise<{
  patientId: string;
} | null> {
  const authUser = await getB2cAuthUser();
  if (!authUser) return null;
  const patient = await prisma.patient.findUnique({
    where: { authUserId: authUser.id },
    select: { id: true },
  });
  if (!patient) return null;
  return { patientId: patient.id };
}

export async function getB2cAuthUser(): Promise<AuthUser | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

export async function requireB2cPatientContext(options?: {
  healthProfileId?: string | null;
}): Promise<
  | { ok: true; ctx: B2cPatientContext }
  | { ok: false; error: string; status: 401 | 403 }
> {
  const authUser = await getB2cAuthUser();
  if (!authUser) {
    return { ok: false, error: "Faça login para continuar.", status: 401 };
  }
  const ctx = await ensureB2cPatientAndPrimaryProfile(
    authUser,
    options?.healthProfileId,
  );
  if (
    options?.healthProfileId &&
    !ctx.profiles.some((profile) => profile.id === options.healthProfileId)
  ) {
    return {
      ok: false,
      error: "Perfil de saúde não encontrado nesta conta.",
      status: 403,
    };
  }
  return { ok: true, ctx };
}
