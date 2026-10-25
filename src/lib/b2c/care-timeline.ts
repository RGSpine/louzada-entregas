import { prisma } from "@/lib/prisma";
import { parseStoredConsultationStructured } from "@/lib/b2c/consultation-structured";
import { journalSourceLabel } from "@/lib/b2c/health-journal-display";
import type {
  CareTimelineEvent,
  HealthShareCandidate,
} from "@/lib/b2c/care-timeline-display";

export type {
  CareTimelineEvent,
  CareTimelineKind,
  HealthShareCandidate,
} from "@/lib/b2c/care-timeline-display";

function consultationLabel(sourceType: string | null): string {
  if (sourceType === "consultation_audio") return "Consulta gravada";
  if (sourceType === "consultation_bundle") return "Consulta gravada + anexos";
  if (sourceType === "exam_ocr") return "Exame / laudo";
  return "Registro da consulta";
}

export async function buildCareTimeline(
  healthProfileId: string,
  take = 40,
): Promise<CareTimelineEvent[]> {
  const summaries = await prisma.clinicalSummary.findMany({
    where: { healthProfileId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      createdAt: true,
      sourceType: true,
      translatedExplanation: true,
      structured: true,
    },
  });
  const journals = await prisma.healthJournalEntry.findMany({
    where: { healthProfileId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, createdAt: true, body: true, source: true },
  });

  const events: CareTimelineEvent[] = [
    ...summaries.map((item) => {
      const structured = parseStoredConsultationStructured(item.structured);
      const who = structured.professionalName
        ? `${structured.professionalName}${structured.specialty ? ` · ${structured.specialty}` : ""}`
        : null;
      return {
        id: `consultation:${item.id}`,
        kind: "consultation" as const,
        at: item.createdAt.toISOString(),
        title: who
          ? `${consultationLabel(item.sourceType)} · ${who}`
          : consultationLabel(item.sourceType),
        body: item.translatedExplanation,
      };
    }),
    ...journals.map((item) => ({
      id: `journal:${item.id}`,
      kind: "journal" as const,
      at: item.createdAt.toISOString(),
      title: `Relato · ${journalSourceLabel(
        item.source === "audio" || item.source === "mixed" ? item.source : "text",
      )}`,
      body: item.body,
    })),
  ];

  return events
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-take);
}

export function formatCareTimelineBlock(
  events: CareTimelineEvent[],
  options?: { maxEvents?: number; chars?: number },
): string {
  const maxEvents = options?.maxEvents ?? 12;
  const chars = options?.chars ?? 900;
  const slice = events.slice(-maxEvents);
  if (slice.length === 0) {
    return "(Ainda sem relato nem consulta gravada nesta linha.)";
  }
  return slice
    .map((event) => {
      const when = new Date(event.at).toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      });
      return `- ${when} · ${event.title}: ${event.body.slice(0, chars)}`;
    })
    .join("\n");
}

export async function listHealthShareCandidates(params: {
  patientId: string;
  healthProfileId: string;
}): Promise<HealthShareCandidate[]> {
  const slots = await prisma.scheduleSlot.findMany({
    where: {
      patientId: params.patientId,
      status: "BOOKED",
    },
    select: {
      professionalProfileId: true,
      professional: {
        select: {
          id: true,
          publicHeadline: true,
          user: { select: { name: true, profession: true } },
          specialties: {
            take: 1,
            select: { specialty: { select: { name: true } } },
          },
        },
      },
    },
    take: 40,
  });
  const grants = await prisma.healthShareGrant.findMany({
    where: { healthProfileId: params.healthProfileId },
    select: { professionalProfileId: true },
  });

  const shared = new Set(grants.map((grant) => grant.professionalProfileId));
  const byId = new Map<string, HealthShareCandidate>();
  for (const slot of slots) {
    const pro = slot.professional;
    if (byId.has(pro.id)) continue;
    byId.set(pro.id, {
      professionalProfileId: pro.id,
      name: pro.user.name?.trim() || "Profissional",
      specialty:
        pro.specialties[0]?.specialty.name ??
        pro.user.profession ??
        pro.publicHeadline,
      shared: shared.has(pro.id),
    });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/** Linha visível na ficha só se o paciente concedeu acesso a este profissional. */
export async function loadSharedCareTimelineForChart(params: {
  tenantUserId: string;
  chartPatientId: string;
}): Promise<CareTimelineEvent[]> {
  const chart = await prisma.patient.findFirst({
    where: { id: params.chartPatientId, userId: params.tenantUserId },
    select: { id: true, email: true },
  });
  if (!chart) return [];

  const profile = await prisma.professionalProfile.findUnique({
    where: { userId: params.tenantUserId },
    select: { id: true },
  });
  if (!profile) return [];

  const email = chart.email?.trim() || null;
  const slots = await prisma.scheduleSlot.findMany({
    where: {
      status: "BOOKED",
      patientId: { not: null },
      professionalProfileId: profile.id,
      OR: [
        { appointment: { patientId: chart.id } },
        ...(email
          ? [
              {
                patient: {
                  authUserId: { not: null },
                  email: { equals: email, mode: "insensitive" as const },
                },
              },
            ]
          : []),
      ],
    },
    select: { patientId: true },
    take: 20,
  });
  const b2cIds = [
    ...new Set(
      slots
        .map((slot) => slot.patientId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (b2cIds.length === 0) return [];

  const grants = await prisma.healthShareGrant.findMany({
    where: {
      professionalProfileId: profile.id,
      healthProfile: { patientId: { in: b2cIds } },
    },
    select: { healthProfileId: true },
  });
  if (grants.length === 0) return [];

  const timelines = await Promise.all(
    grants.map((grant) => buildCareTimeline(grant.healthProfileId, 30)),
  );
  return timelines
    .flat()
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-40);
}
