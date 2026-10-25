import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import { getAppBaseUrl } from "@/lib/app-url";
import { buildCrmWhatsAppOutreachUrl } from "@/lib/crm/whatsapp-outreach";

export type ProfessionalLinkView = {
  id: string;
  professionalProfileId: string;
  name: string;
  specialty: string | null;
  status: "PENDING" | "ACTIVE" | "REVOKED";
  initiatedBy: "PATIENT" | "PROFESSIONAL";
};

const LINK_SELECT = {
  id: true,
  status: true,
  initiatedBy: true,
  professionalProfileId: true,
  professional: {
    select: {
      publicSpecialty: true,
      publicHeadline: true,
      user: { select: { name: true, profession: true } },
    },
  },
} as const;

function asStatus(value: string): ProfessionalLinkView["status"] {
  if (value === "ACTIVE" || value === "REVOKED") return value;
  return "PENDING";
}

function asInitiator(value: string): ProfessionalLinkView["initiatedBy"] {
  return value === "PROFESSIONAL" ? "PROFESSIONAL" : "PATIENT";
}

function toLinkView(row: {
  id: string;
  status: string;
  initiatedBy: string;
  professionalProfileId: string;
  professional: {
    publicSpecialty: string | null;
    publicHeadline: string | null;
    user: { name: string | null; profession: string | null };
  };
}): ProfessionalLinkView {
  return {
    id: row.id,
    professionalProfileId: row.professionalProfileId,
    name: row.professional.user.name?.trim() || "Profissional",
    specialty:
      row.professional.publicSpecialty?.trim() ||
      row.professional.user.profession?.trim() ||
      row.professional.publicHeadline?.trim() ||
      null,
    status: asStatus(row.status),
    initiatedBy: asInitiator(row.initiatedBy),
  };
}

export async function listProfessionalLinks(
  healthProfileId: string,
): Promise<ProfessionalLinkView[]> {
  const rows = await prisma.professionalPatientLink.findMany({
    where: { healthProfileId, status: { not: "REVOKED" } },
    orderBy: { updatedAt: "desc" },
    take: 40,
    select: LINK_SELECT,
  });
  return rows.map(toLinkView);
}

export async function searchLinkableProfessionals(query: string) {
  const name = sanitizeText(query).trim().slice(0, 80);
  if (name.length < 2) return [];
  const rows = await prisma.professionalProfile.findMany({
    where: {
      user: {
        name: { contains: name, mode: "insensitive" },
        OR: [{ profession: null }, { profession: { not: "Estudante" } }],
      },
    },
    take: 8,
    select: {
      id: true,
      publicSpecialty: true,
      publicHeadline: true,
      user: { select: { name: true, profession: true } },
    },
  });
  return rows.map((row) => ({
    professionalProfileId: row.id,
    name: row.user.name?.trim() || "Profissional",
    specialty:
      row.publicSpecialty?.trim() ||
      row.user.profession?.trim() ||
      row.publicHeadline?.trim() ||
      null,
  }));
}

export async function linkProfessionalAsPatient(params: {
  healthProfileId: string;
  professionalProfileId: string;
}) {
  const existing = await prisma.professionalPatientLink.findUnique({
    where: {
      healthProfileId_professionalProfileId: {
        healthProfileId: params.healthProfileId,
        professionalProfileId: params.professionalProfileId,
      },
    },
    select: { id: true, status: true },
  });
  if (existing?.status === "ACTIVE") return { already: true };
  if (existing) {
    await prisma.professionalPatientLink.update({
      where: { id: existing.id },
      data: { status: "ACTIVE", initiatedBy: "PATIENT" },
    });
    return { already: false };
  }
  await prisma.professionalPatientLink.create({
    data: {
      healthProfileId: params.healthProfileId,
      professionalProfileId: params.professionalProfileId,
      status: "ACTIVE",
      initiatedBy: "PATIENT",
    },
  });
  return { already: false };
}

export async function respondToProfessionalInvite(params: {
  healthProfileId: string;
  linkId: string;
  accept: boolean;
}) {
  const link = await prisma.professionalPatientLink.findFirst({
    where: {
      id: params.linkId,
      healthProfileId: params.healthProfileId,
      status: "PENDING",
      initiatedBy: "PROFESSIONAL",
    },
    select: { id: true },
  });
  if (!link) return false;
  await prisma.professionalPatientLink.update({
    where: { id: link.id },
    data: { status: params.accept ? "ACTIVE" : "REVOKED" },
  });
  return true;
}

export async function revokeProfessionalLink(params: {
  healthProfileId: string;
  linkId: string;
}) {
  const link = await prisma.professionalPatientLink.findFirst({
    where: { id: params.linkId, healthProfileId: params.healthProfileId },
    select: { id: true },
  });
  if (!link) return false;
  await prisma.professionalPatientLink.update({
    where: { id: link.id },
    data: { status: "REVOKED" },
  });
  return true;
}

async function chartStillOwned(professionalUserId: string, chartPatientId: string) {
  return prisma.patient.findFirst({
    where: { id: chartPatientId, userId: professionalUserId, agendaOnly: false },
    select: { id: true },
  });
}

async function ensureProfessionalChart(params: {
  professionalUserId: string;
  healthProfileId: string;
  name: string;
  email: string | null;
  phone: string | null;
  dateOfBirth: Date | null;
}): Promise<{ id: string; created: boolean }> {
  const invited = await prisma.professionalMapInvite.findFirst({
    where: {
      professionalUserId: params.professionalUserId,
      acceptedHealthProfileId: params.healthProfileId,
      acceptedAt: { not: null },
    },
    orderBy: { acceptedAt: "desc" },
    select: { chartPatientId: true },
  });
  if (invited) {
    const chart = await chartStillOwned(params.professionalUserId, invited.chartPatientId);
    if (chart) return { id: chart.id, created: false };
  }

  const prior = await prisma.sharedHealthUpdate.findFirst({
    where: {
      healthProfileId: params.healthProfileId,
      professionalUserId: params.professionalUserId,
      chartPatientId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { chartPatientId: true },
  });
  if (prior?.chartPatientId) {
    const chart = await chartStillOwned(params.professionalUserId, prior.chartPatientId);
    if (chart) return { id: chart.id, created: false };
  }

  const email = params.email?.trim().toLowerCase() || null;
  if (email) {
    const existing = await prisma.patient.findFirst({
      where: {
        userId: params.professionalUserId,
        agendaOnly: false,
        email: { equals: email, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (existing) return { id: existing.id, created: false };
  }
  const created = await prisma.patient.create({
    data: {
      userId: params.professionalUserId,
      name: params.name.slice(0, 200) || "Paciente",
      email,
      phone: params.phone,
      dateOfBirth: params.dateOfBirth,
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

export async function shareHealthUpdateWithLinks(params: {
  healthProfileId: string;
  patientName: string;
  email: string | null;
  phone: string | null;
  dateOfBirth: Date | null;
  professionalProfileIds: string[];
  kind: "JOURNAL" | "CONSULTATION" | "EXAM";
  sourceId: string;
  title: string;
  body: string;
}) {
  const ids = [...new Set(params.professionalProfileIds)].slice(0, 8);
  const title = sanitizeText(params.title).slice(0, 180) || "Atualização de saúde";
  const body = sanitizeText(params.body).slice(0, 4000);
  let sent = 0;
  for (const professionalProfileId of ids) {
    const link = await prisma.professionalPatientLink.findFirst({
      where: {
        healthProfileId: params.healthProfileId,
        professionalProfileId,
        status: "ACTIVE",
      },
      select: { professional: { select: { userId: true } } },
    });
    if (!link) continue;
    const existingShare = await prisma.sharedHealthUpdate.findUnique({
      where: {
        professionalProfileId_kind_sourceId: {
          professionalProfileId,
          kind: params.kind,
          sourceId: params.sourceId,
        },
      },
      select: { id: true },
    });
    if (existingShare) {
      sent += 1;
      continue;
    }
    const chart = await ensureProfessionalChart({
      professionalUserId: link.professional.userId,
      healthProfileId: params.healthProfileId,
      name: params.patientName,
      email: params.email,
      phone: params.phone,
      dateOfBirth: params.dateOfBirth,
    });
    await prisma.sharedHealthUpdate.create({
      data: {
        healthProfileId: params.healthProfileId,
        professionalProfileId,
        professionalUserId: link.professional.userId,
        chartPatientId: chart.id,
        kind: params.kind,
        sourceId: params.sourceId,
        title,
        body,
        status: chart.created ? "ATTACHED" : "INBOX",
      },
    });
    sent += 1;
  }
  return sent;
}

export async function listSharedUpdatesForChart(params: {
  professionalUserId: string;
  chartPatientId: string;
}) {
  return prisma.sharedHealthUpdate.findMany({
    where: {
      professionalUserId: params.professionalUserId,
      chartPatientId: params.chartPatientId,
      status: { in: ["INBOX", "ATTACHED"] },
    },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: {
      id: true,
      kind: true,
      title: true,
      body: true,
      status: true,
      createdAt: true,
    },
  });
}

export async function setSharedUpdateStatus(params: {
  professionalUserId: string;
  updateId: string;
  status: "ATTACHED" | "DISMISSED";
}) {
  const row = await prisma.sharedHealthUpdate.findFirst({
    where: { id: params.updateId, professionalUserId: params.professionalUserId },
    select: { id: true },
  });
  if (!row) return false;
  await prisma.sharedHealthUpdate.update({
    where: { id: row.id },
    data: { status: params.status },
  });
  return true;
}

export async function invitePatientByEmail(params: {
  professionalUserId: string;
  email: string;
}) {
  const email = params.email.trim().toLowerCase();
  const profile = await prisma.professionalProfile.findUnique({
    where: { userId: params.professionalUserId },
    select: { id: true },
  });
  if (!profile) return { ok: false as const, error: "Seu perfil profissional não foi encontrado." };
  const patient = await prisma.patient.findFirst({
    where: { authUserId: { not: null }, email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  if (!patient) {
    return {
      ok: false as const,
      error: "Não há conta de paciente no Mapa de Saúde com esse e-mail.",
    };
  }
  const healthProfile = await prisma.healthProfile.findFirst({
    where: { patientId: patient.id, isPrimary: true },
    select: { id: true },
  });
  if (!healthProfile) {
    return { ok: false as const, error: "Essa conta ainda não tem perfil de saúde." };
  }
  const existing = await prisma.professionalPatientLink.findUnique({
    where: {
      healthProfileId_professionalProfileId: {
        healthProfileId: healthProfile.id,
        professionalProfileId: profile.id,
      },
    },
    select: { id: true, status: true },
  });
  if (existing?.status === "ACTIVE") {
    return { ok: true as const, already: true };
  }
  if (existing) {
    await prisma.professionalPatientLink.update({
      where: { id: existing.id },
      data: { status: "PENDING", initiatedBy: "PROFESSIONAL" },
    });
  } else {
    await prisma.professionalPatientLink.create({
      data: {
        healthProfileId: healthProfile.id,
        professionalProfileId: profile.id,
        status: "PENDING",
        initiatedBy: "PROFESSIONAL",
      },
    });
  }
  return { ok: true as const, already: false };
}

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,80}$/;

export function isMapInviteToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

async function activateProfessionalLink(params: {
  healthProfileId: string;
  professionalProfileId: string;
}) {
  const existing = await prisma.professionalPatientLink.findUnique({
    where: {
      healthProfileId_professionalProfileId: {
        healthProfileId: params.healthProfileId,
        professionalProfileId: params.professionalProfileId,
      },
    },
    select: { id: true, status: true },
  });
  if (existing?.status === "ACTIVE") return;
  if (existing) {
    await prisma.professionalPatientLink.update({
      where: { id: existing.id },
      data: { status: "ACTIVE", initiatedBy: "PROFESSIONAL" },
    });
    return;
  }
  await prisma.professionalPatientLink.create({
    data: {
      healthProfileId: params.healthProfileId,
      professionalProfileId: params.professionalProfileId,
      status: "ACTIVE",
      initiatedBy: "PROFESSIONAL",
    },
  });
}

export async function listPatientsWithoutMapAccount(professionalUserId: string) {
  const charts = await prisma.patient.findMany({
    where: { userId: professionalUserId, agendaOnly: false },
    orderBy: { name: "asc" },
    take: 200,
    select: { id: true, name: true, email: true, phone: true },
  });
  const emails = [
    ...new Set(
      charts
        .map((chart) => chart.email?.trim().toLowerCase())
        .filter((email): email is string => Boolean(email)),
    ),
  ];
  const registeredEmails = new Set<string>();
  if (emails.length > 0) {
    const accounts = await prisma.patient.findMany({
      where: {
        authUserId: { not: null },
        OR: emails.map((email) => ({
          email: { equals: email, mode: "insensitive" as const },
        })),
      },
      select: { email: true },
    });
    for (const account of accounts) {
      const email = account.email?.trim().toLowerCase();
      if (email) registeredEmails.add(email);
    }
  }
  const professional = await prisma.user.findUnique({
    where: { id: professionalUserId },
    select: { name: true },
  });
  return {
    professionalName: professional?.name?.trim() || "seu profissional",
    patients: charts
      .filter((chart) => {
        const email = chart.email?.trim().toLowerCase();
        return !email || !registeredEmails.has(email);
      })
      .map((chart) => ({
        id: chart.id,
        name: chart.name,
        phone: chart.phone,
      })),
  };
}

export async function createMapWhatsAppInvite(params: {
  professionalUserId: string;
  chartPatientId: string;
  phone: string;
}) {
  const profile = await prisma.professionalProfile.findUnique({
    where: { userId: params.professionalUserId },
    select: { id: true, user: { select: { name: true } } },
  });
  if (!profile) return { ok: false as const, error: "Seu perfil profissional não foi encontrado." };
  const chart = await prisma.patient.findFirst({
    where: {
      id: params.chartPatientId,
      userId: params.professionalUserId,
      agendaOnly: false,
    },
    select: { id: true, name: true, phone: true },
  });
  if (!chart) return { ok: false as const, error: "Paciente não encontrado." };

  const whatsapp = buildCrmWhatsAppOutreachUrl({
    phone: params.phone,
    text: "convite",
  });
  if (!whatsapp.ok) {
    return { ok: false as const, error: "Informe um WhatsApp com DDD." };
  }
  if (!chart.phone?.trim()) {
    await prisma.patient.update({
      where: { id: chart.id },
      data: { phone: sanitizeText(params.phone).slice(0, 40) },
    });
  }

  const now = new Date();
  await prisma.professionalMapInvite.updateMany({
    where: { chartPatientId: chart.id, acceptedAt: null, expiresAt: { gt: now } },
    data: { expiresAt: now },
  });
  const token = randomBytes(24).toString("base64url");
  await prisma.professionalMapInvite.create({
    data: {
      token,
      professionalProfileId: profile.id,
      professionalUserId: params.professionalUserId,
      chartPatientId: chart.id,
      expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
    },
  });

  const inviteUrl = `${getAppBaseUrl()}/convite/${token}`;
  const firstName = chart.name.trim().split(/\s+/)[0] || "olá";
  const professionalName = profile.user.name?.trim() || "seu profissional";
  const text = [
    `Olá, ${firstName}! Aqui é ${professionalName}.`,
    "Crie sua conta no Mapa de Saúde da Louzada Entregas por este link.",
    "Ao se cadastrar, sua conta fica vinculada a mim. Você escolhe o que compartilhar.",
    inviteUrl,
  ].join("\n");
  const link = buildCrmWhatsAppOutreachUrl({ phone: params.phone, text });
  if (!link.ok) return { ok: false as const, error: link.reason };
  return { ok: true as const, whatsappUrl: link.url };
}

export async function previewMapInvite(token: string) {
  if (!isMapInviteToken(token)) return null;
  const invite = await prisma.professionalMapInvite.findUnique({
    where: { token },
    select: {
      expiresAt: true,
      acceptedAt: true,
      professional: { select: { user: { select: { name: true } } } },
    },
  });
  if (!invite || invite.acceptedAt || invite.expiresAt.getTime() < Date.now()) return null;
  return {
    professionalName: invite.professional.user.name?.trim() || "seu profissional",
  };
}

export async function redeemMapInviteForAuthUser(authUserId: string, token: string) {
  if (!isMapInviteToken(token)) return false;
  const patient = await prisma.patient.findUnique({
    where: { authUserId },
    select: { id: true, email: true, phone: true },
  });
  if (!patient) return false;
  const healthProfile = await prisma.healthProfile.findFirst({
    where: { patientId: patient.id, isPrimary: true },
    select: { id: true },
  });
  if (!healthProfile) return false;
  const invite = await prisma.professionalMapInvite.findUnique({
    where: { token },
    select: {
      id: true,
      professionalProfileId: true,
      professionalUserId: true,
      chartPatientId: true,
      expiresAt: true,
      acceptedAt: true,
    },
  });
  if (!invite || invite.acceptedAt || invite.expiresAt.getTime() < Date.now()) return false;

  await activateProfessionalLink({
    healthProfileId: healthProfile.id,
    professionalProfileId: invite.professionalProfileId,
  });
  const chart = await prisma.patient.findFirst({
    where: {
      id: invite.chartPatientId,
      userId: invite.professionalUserId,
      agendaOnly: false,
    },
    select: { id: true, email: true, phone: true },
  });
  if (chart && !chart.email && patient.email) {
    await prisma.patient.update({
      where: { id: chart.id },
      data: {
        email: patient.email,
        ...(chart.phone ? {} : patient.phone ? { phone: patient.phone } : {}),
      },
    });
  }
  await prisma.professionalMapInvite.update({
    where: { id: invite.id },
    data: {
      acceptedAt: new Date(),
      acceptedHealthProfileId: healthProfile.id,
    },
  });
  return true;
}

export async function listIncomingShareNotifications(professionalUserId: string) {
  return prisma.sharedHealthUpdate.findMany({
    where: {
      professionalUserId,
      status: { in: ["INBOX", "ATTACHED"] },
      createdAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 21) },
    },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: {
      id: true,
      title: true,
      kind: true,
      status: true,
      createdAt: true,
      chartPatientId: true,
      healthProfile: { select: { name: true } },
    },
  });
}
