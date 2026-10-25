import { getRequestDbUser } from "@/lib/auth/request-user";
import { prisma } from "@/lib/prisma";

/** ID do User (Prisma) da sessão Supabase atual, ou null se não autenticado. */
export async function getAuthenticatedDbUserId(): Promise<string | null> {
  const dbUser = await getRequestDbUser();
  return dbUser?.id ?? null;
}

/** Garante que o paciente pertence ao profissional logado (isolamento LGPD). */
export async function isPatientOwnedByUser(
  patientId: string,
  userId: string,
): Promise<boolean> {
  const row = await prisma.patient.findFirst({
    where: { id: patientId, userId },
    select: { id: true },
  });
  return !!row;
}
