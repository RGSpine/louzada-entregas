import { prisma } from "@/lib/prisma";
import {
  type HealthJournalEntryView,
  type HealthJournalSource,
} from "@/lib/b2c/health-journal-display";

export {
  journalSourceLabel,
  type HealthJournalEntryView,
  type HealthJournalSource,
} from "@/lib/b2c/health-journal-display";

const ENTRY_SELECT = {
  id: true,
  body: true,
  source: true,
  createdAt: true,
  healthProfile: { select: { name: true } },
} as const;

function asSource(value: string): HealthJournalSource {
  if (value === "audio" || value === "mixed") return value;
  return "text";
}

function toView(row: {
  id: string;
  body: string;
  source: string;
  createdAt: Date;
  healthProfile: { name: string };
}): HealthJournalEntryView {
  return {
    id: row.id,
    body: row.body,
    source: asSource(row.source),
    createdAt: row.createdAt.toISOString(),
    profileName: row.healthProfile.name,
  };
}

export async function listHealthJournal(
  healthProfileId: string,
  take = 30,
): Promise<HealthJournalEntryView[]> {
  const rows = await prisma.healthJournalEntry.findMany({
    where: { healthProfileId },
    orderBy: { createdAt: "desc" },
    take,
    select: ENTRY_SELECT,
  });
  return rows.map(toView);
}

export function formatHealthJournalBlock(
  entries: HealthJournalEntryView[],
): string {
  if (entries.length === 0) {
    return "(Sem relato próprio do paciente.)";
  }
  return entries
    .map((entry, index) => {
      const when = new Date(entry.createdAt).toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      });
      const cap = index < 4 ? 2800 : 700;
      return `- ${when} (${journalSourceLabel(entry.source)}): ${entry.body.slice(0, cap)}`;
    })
    .join("\n");
}

/**
 * Relatos do mapa B2C visíveis na ficha do profissional.
 * Só entra quem reservou com este profissional e a ficha está ligada
 * pela marcação ou pelo mesmo e-mail.
 */
export async function listJournalForProfessionalChart(params: {
  tenantUserId: string;
  chartPatientId: string;
}): Promise<HealthJournalEntryView[]> {
  const chart = await prisma.patient.findFirst({
    where: { id: params.chartPatientId, userId: params.tenantUserId },
    select: { id: true, email: true },
  });
  if (!chart) return [];

  const email = chart.email?.trim() || null;
  const slots = await prisma.scheduleSlot.findMany({
    where: {
      status: "BOOKED",
      patientId: { not: null },
      professional: { userId: params.tenantUserId },
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
    take: 30,
  });

  const b2cIds = [
    ...new Set(
      slots
        .map((slot) => slot.patientId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (b2cIds.length === 0) return [];

  const rows = await prisma.healthJournalEntry.findMany({
    where: { healthProfile: { patientId: { in: b2cIds } } },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: ENTRY_SELECT,
  });
  return rows.map(toView);
}
