import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/** ID do User (Prisma) da sessão Supabase atual, ou null se não autenticado. */
export async function getAuthenticatedDbUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !authUser) {
    return null;
  }

  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [{ authUserId: authUser.id }, { email: authUser.email ?? "" }],
    },
    select: { id: true },
  });

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
