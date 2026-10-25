import { AppointmentSource, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { GOOGLE_AGENDA_PLACEHOLDER_PATIENT_NAME } from "@/lib/patient-clinical-scope";

export type GoogleSyncPatientDiagnostic = {
  userId: string;
  userEmail: string | null;
  totalPatients: number;
  clinicalPatients: number;
  agendaPlaceholderPatients: number;
  googleImportGhostPatients: number;
  googleSyncAppointments: number;
  ghostSamples: Array<{ id: string; name: string; googleAppointmentCount: number }>;
};

/** Pacientes criados pela importação Google sem dados clínicos. */
export const googleImportGhostPatientWhere: Prisma.PatientWhereInput = {
  agendaOnly: false,
  evolutions: { none: {} },
  exams: { none: {} },
  patientServicePurchases: { none: {} },
  financialTransactions: { none: {} },
  chatSession: { is: null },
  appointments: {
    some: { source: AppointmentSource.GOOGLE_SYNC },
    every: { source: AppointmentSource.GOOGLE_SYNC },
  },
};

export async function diagnoseGoogleSyncPatientsForUser(
  userId: string,
  userEmail: string | null,
): Promise<GoogleSyncPatientDiagnostic> {
  const [
    totalPatients,
    clinicalPatients,
    agendaPlaceholderPatients,
    googleImportGhostPatients,
    googleSyncAppointments,
    ghostSamples,
  ] = await Promise.all([
    prisma.patient.count({ where: { userId } }),
    prisma.patient.count({ where: { userId, agendaOnly: false } }),
    prisma.patient.count({ where: { userId, agendaOnly: true } }),
    prisma.patient.count({ where: { userId, ...googleImportGhostPatientWhere } }),
    prisma.appointment.count({
      where: { professionalUserId: userId, source: AppointmentSource.GOOGLE_SYNC },
    }),
    prisma.patient.findMany({
      where: { userId, ...googleImportGhostPatientWhere },
      select: {
        id: true,
        name: true,
        _count: { select: { appointments: true } },
      },
      orderBy: { name: "asc" },
      take: 25,
    }),
  ]);

  return {
    userId,
    userEmail,
    totalPatients,
    clinicalPatients,
    agendaPlaceholderPatients,
    googleImportGhostPatients,
    googleSyncAppointments,
    ghostSamples: ghostSamples.map((p) => ({
      id: p.id,
      name: p.name,
      googleAppointmentCount: p._count.appointments,
    })),
  };
}

export async function getOrCreateAgendaPlaceholderPatientId(userId: string): Promise<string> {
  const existing = await prisma.patient.findFirst({
    where: { userId, agendaOnly: true },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.patient.create({
    data: {
      userId,
      name: GOOGLE_AGENDA_PLACEHOLDER_PATIENT_NAME,
      agendaOnly: true,
    },
    select: { id: true },
  });
  return created.id;
}

export type GoogleSyncPatientCleanupResult = {
  usersProcessed: number;
  appointmentsReassigned: number;
  patientsDeleted: number;
  placeholdersEnsured: number;
};

export async function cleanupGoogleImportGhostPatients(options?: {
  userId?: string;
  dryRun?: boolean;
}): Promise<GoogleSyncPatientCleanupResult> {
  const dryRun = options?.dryRun ?? false;
  const result: GoogleSyncPatientCleanupResult = {
    usersProcessed: 0,
    appointmentsReassigned: 0,
    patientsDeleted: 0,
    placeholdersEnsured: 0,
  };

  const ghosts = await prisma.patient.findMany({
    where: {
      ...(options?.userId ? { userId: options.userId } : {}),
      ...googleImportGhostPatientWhere,
    },
    select: {
      id: true,
      userId: true,
      appointments: {
        where: { source: AppointmentSource.GOOGLE_SYNC },
        select: { id: true },
      },
    },
  });

  const ghostsByUser = new Map<string, typeof ghosts>();
  for (const ghost of ghosts) {
    if (!ghost.userId) continue;
    const list = ghostsByUser.get(ghost.userId) ?? [];
    list.push(ghost);
    ghostsByUser.set(ghost.userId, list);
  }

  for (const [userId, userGhosts] of ghostsByUser) {
    result.usersProcessed += 1;

    let placeholderId: string;
    if (dryRun) {
      const existing = await prisma.patient.findFirst({
        where: { userId, agendaOnly: true },
        select: { id: true },
      });
      placeholderId = existing?.id ?? "(novo placeholder)";
      if (!existing) result.placeholdersEnsured += 1;
    } else {
      placeholderId = await getOrCreateAgendaPlaceholderPatientId(userId);
      result.placeholdersEnsured += 1;
    }

    const ghostIds = userGhosts.map((g) => g.id);
    const appointmentIds = userGhosts.flatMap((g) => g.appointments.map((a) => a.id));
    result.appointmentsReassigned += appointmentIds.length;
    result.patientsDeleted += ghostIds.length;

    if (dryRun) continue;

    await prisma.$transaction(async (tx) => {
      if (appointmentIds.length > 0) {
        await tx.appointment.updateMany({
          where: { id: { in: appointmentIds } },
          data: { patientId: placeholderId },
        });
      }
      await tx.patient.deleteMany({
        where: { id: { in: ghostIds } },
      });
    });
  }

  return result;
}
