"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  cancelAppointmentForUser,
  createAppointmentForUser,
  listAppointmentPatientsForUser,
  listAppointmentsInRangeForUser,
  updateAppointmentForUser,
  type AppointmentListItem,
} from "@/server/services/appointments";
import {
  getAppointmentEvolutionBootstrapForUser,
  type AppointmentEvolutionBootstrap,
} from "@/server/services/appointment-evolution-link";
import {
  generateTreatmentPlanAppointmentsForUser,
  listTreatmentPlanBatchCandidatesForUser,
} from "@/server/services/appointment-batch";
import { generateAppointmentSeriesForUser } from "@/server/services/appointment-recurrence";
import type { TreatmentPlanBatchCandidate } from "@/lib/appointment-treatment-plan-batch";
import type { SuggestedSlot } from "@/lib/appointment-suggested-slots";
import { getPatientAccessScope } from "@/lib/intra-user/patient-access";

async function getAuthenticatedUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !authUser) {
    return null;
  }

  const { prisma } = await import("@/lib/prisma");
  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [{ authUserId: authUser.id }, { email: authUser.email ?? "" }],
    },
    select: { id: true },
  });

  return dbUser?.id ?? null;
}

export type AppointmentActionResult<T = unknown> =
  | { success: true; data?: T }
  | { success: false; error: string; suggestedSlots?: SuggestedSlot[] };

export async function createAppointment(
  input: unknown,
): Promise<AppointmentActionResult<{ id: string }>> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { success: false, error: "Não autenticado." };
  }

  const scope = await getPatientAccessScope();
  if (!scope || scope.denied) {
    return { success: false, error: "Selecione o perfil profissional para continuar." };
  }
  const result = await createAppointmentForUser(userId, input, {
    attendingIntraUserId: scope.activeIntraUser?.id ?? null,
    activeIntraUser: scope.activeIntraUser ?? null,
  });
  if (!result.success) {
    return {
      success: false,
      error: result.error,
      suggestedSlots: result.suggestedSlots,
    };
  }

  // Placeholder agendaOnly não entra na lista clínica — não revalidar /patients.
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/agenda");

  return { success: true, data: result.data };
}

export async function updateAppointment(
  input: unknown,
): Promise<
  AppointmentActionResult<{
    id: string;
    completionEffects?: import("@/lib/finance/appointment-income").AppointmentCompletionEffects;
  }>
> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { success: false, error: "Não autenticado." };
  }

  const scope = await getPatientAccessScope();
  if (!scope || scope.denied) {
    return { success: false, error: "Selecione o perfil profissional para continuar." };
  }
  const result = await updateAppointmentForUser(userId, input, {
    activeIntraUser: scope.activeIntraUser ?? null,
  });
  if (!result.success) {
    return {
      success: false,
      error: result.error,
      suggestedSlots: result.suggestedSlots,
    };
  }

  if (result.data?.becameCompleted) {
    revalidatePath("/dashboard/finances");
  }
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/agenda");

  return {
    success: true,
    data: {
      id: result.data!.id,
      completionEffects: result.data?.completionEffects,
    },
  };
}

export async function cancelAppointment(
  input: unknown,
): Promise<AppointmentActionResult<{ id: string }>> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { success: false, error: "Não autenticado." };
  }

  const scope = await getPatientAccessScope();
  if (!scope || scope.denied) {
    return { success: false, error: "Selecione o perfil profissional para continuar." };
  }

  const result = await cancelAppointmentForUser(
    userId,
    input,
    scope.activeIntraUser,
  );
  if (!result.success) {
    return { success: false, error: result.error };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/agenda");
  if (result.data?.removal === "agenda") {
    revalidatePath("/dashboard/finances");
  }

  return { success: true, data: result.data };
}

export async function listAppointmentsInRange(
  input: unknown,
): Promise<AppointmentActionResult<AppointmentListItem[]>> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { success: false, error: "Não autenticado." };
  }

  const scope = await getPatientAccessScope();
  if (!scope || scope.denied) {
    return { success: false, error: "Selecione o perfil profissional para continuar." };
  }

  const result = await listAppointmentsInRangeForUser(
    userId,
    input,
    scope.activeIntraUser ?? null,
  );
  if (!result.success) {
    return { success: false, error: result.error };
  }

  return { success: true, data: result.data };
}

export async function listAppointmentPatients(): Promise<
  AppointmentActionResult<Array<{ id: string; name: string }>>
> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { success: false, error: "Não autenticado." };
  }

  const scope = await getPatientAccessScope();
  if (!scope || scope.denied) {
    return { success: false, error: "Selecione o perfil profissional para continuar." };
  }
  const result = await listAppointmentPatientsForUser(
    userId,
    scope.activeIntraUser ?? null,
  );
  if (!result.success) {
    return { success: false, error: result.error };
  }

  return { success: true, data: result.data };
}

export async function getAppointmentEvolutionBootstrap(
  appointmentId: string,
): Promise<AppointmentActionResult<AppointmentEvolutionBootstrap>> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { success: false, error: "Não autenticado." };
  }

  const scope = await getPatientAccessScope();
  if (!scope || scope.denied || !scope.activeIntraUser) {
    return { success: false, error: "Selecione o perfil profissional para continuar." };
  }

  return getAppointmentEvolutionBootstrapForUser(userId, appointmentId, {
    activeIntraUser: scope.activeIntraUser,
  });
}

export async function listPendingTreatmentPlanSessions(
  patientId: string,
  appointmentId?: string,
): Promise<
  AppointmentActionResult<
    Array<{
      id: string;
      sequence: number;
      totalSessions: number;
      serviceName: string;
      allocatedPriceCents: number;
      professionalServiceId: string;
      serviceSpaceId: string | null;
    }>
  >
> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { success: false, error: "Não autenticado." };
  }

  const { prisma } = await import("@/lib/prisma");
  const scope = await getPatientAccessScope();
  if (!scope || scope.denied) {
    return { success: false, error: "Selecione o perfil profissional para continuar." };
  }
  const { buildPatientScopeWhere } = await import("@/lib/intra-user/patient-scope");
  const own = await prisma.patient.findFirst({
    where: { ...buildPatientScopeWhere(scope), id: patientId },
    select: { id: true },
  });
  if (!own) {
    return { success: false, error: "Paciente não encontrado." };
  }

  const { listPendingTreatmentPlanSessionsForPatient } = await import(
    "@/lib/appointment-plan-session"
  );
  const sessions = await listPendingTreatmentPlanSessionsForPatient(
    userId,
    patientId,
    appointmentId,
  );

  return {
    success: true,
    data: sessions.map((s) => ({
      id: s.id,
      sequence: s.sequence,
      totalSessions: s.totalSessions,
      serviceName: s.serviceName,
      allocatedPriceCents: s.allocatedPriceCents,
      professionalServiceId: s.professionalServiceId,
      serviceSpaceId: s.serviceSpaceId,
    })),
  };
}

export async function listTreatmentPlanBatchCandidates(
  patientId?: string,
): Promise<AppointmentActionResult<TreatmentPlanBatchCandidate[]>> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { success: false, error: "Não autenticado." };
  }

  return listTreatmentPlanBatchCandidatesForUser(userId, patientId);
}

export async function generateTreatmentPlanAppointments(
  input: unknown,
): Promise<
  AppointmentActionResult<{
    createdIds: string[];
    createdCount: number;
    firstStartAt: Date;
    lastStartAt: Date;
  }>
> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { success: false, error: "Não autenticado." };
  }

  const result = await generateTreatmentPlanAppointmentsForUser(userId, input);
  if (!result.success) {
    return {
      success: false,
      error: result.error,
      suggestedSlots: result.suggestedSlots,
    };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/agenda");
  revalidatePath("/dashboard/finances");

  return { success: true, data: result.data };
}

export async function generateAppointmentSeries(
  input: unknown,
): Promise<
  AppointmentActionResult<{
    seriesId: string;
    createdIds: string[];
    createdCount: number;
    totalCount: number;
    firstStartAt: Date;
    lastStartAt: Date;
  }>
> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { success: false, error: "Não autenticado." };
  }

  const scope = await getPatientAccessScope();
  if (!scope || scope.denied) {
    return { success: false, error: "Selecione o perfil profissional para continuar." };
  }

  const result = await generateAppointmentSeriesForUser(
    userId,
    input,
    scope.activeIntraUser ?? null,
  );
  if (!result.success) {
    return {
      success: false,
      error: result.error,
      suggestedSlots: result.suggestedSlots,
    };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/agenda");

  return { success: true, data: result.data };
}

export async function registerAppointmentFinanceInAgenda(
  input: unknown,
): Promise<AppointmentActionResult<{ message: string }>> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { success: false, error: "Não autenticado." };
  }

  const { registerAgendaAppointmentFinanceForUser } = await import(
    "@/server/services/appointment-finance"
  );
  const result = await registerAgendaAppointmentFinanceForUser(userId, input);
  if (!result.success) {
    return { success: false, error: result.error };
  }

  revalidatePath("/dashboard/finances");
  revalidatePath("/dashboard/agenda");

  return { success: true, data: { message: result.message } };
}
