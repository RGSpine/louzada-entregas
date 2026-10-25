"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import {
  getGoogleCalendarConnectPath,
  resolveGoogleCalendarConnectionStatus,
  syncAppointmentWithGoogleCalendar,
} from "@/lib/google-calendar-sync";
import { GOOGLE_OAUTH_REVOKED_MESSAGE, invalidateGoogleOAuthAccount } from "@/lib/google-oauth-tokens";
import { importEventsFromGoogleCalendar } from "@/lib/google-calendar-import";
import { runGoogleCalendarBidirectionalSync } from "@/lib/google-calendar-bidirectional";
import { getGoogleOAuthEnvDiagnostics, isGoogleOAuthConfigured } from "@/lib/google-oauth-link";
import {
  canRequestGoogleCalendarManualSync,
  canUseGoogleCalendarIntegration,
  GOOGLE_CALENDAR_INTEGRATION_ROLLOUT_MESSAGE,
  GOOGLE_CALENDAR_MANUAL_ADMIN_PHONE,
  GOOGLE_CALENDAR_MANUAL_SYNC_PENDING_MESSAGE,
} from "@/lib/google-calendar-access";
import { sendGoogleCalendarManualEnrollmentEmail } from "@/lib/email";
import { enforceRateLimit } from "@/lib/rate-limit";
import { planDisplayName } from "@/lib/plan-tier";

const ManualGoogleEmailSchema = z.object({
  googleEmail: z.string().trim().toLowerCase().email("Informe um e-mail Google válido."),
});

type ProfessionalUser = {
  id: string;
  email: string | null;
  name: string | null;
  plan: string | null;
  isInfluencer: boolean;
  googleCalendarManualEmail: string | null;
  googleCalendarManualRequestedAt: Date | null;
  googleCalendarManualApprovedAt: Date | null;
};

async function getProfessionalUser(): Promise<ProfessionalUser | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
    error,
  } = await supabase.auth.getUser();
  if (error || !authUser) return null;
  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [{ authUserId: authUser.id }, { email: authUser.email ?? "" }],
    },
    select: {
      id: true,
      email: true,
      name: true,
      plan: true,
      isInfluencer: true,
      googleCalendarManualEmail: true,
      googleCalendarManualRequestedAt: true,
      googleCalendarManualApprovedAt: true,
    },
  });
  return dbUser ?? null;
}

function integrationOptionsForUser(user: ProfessionalUser) {
  return { googleCalendarManualApprovedAt: user.googleCalendarManualApprovedAt };
}

export async function getAgendaGoogleCalendarStatus(): Promise<{
  success: boolean;
  connected?: boolean;
  hasCalendarScope?: boolean;
  needsReconnect?: boolean;
  oauthConfigured?: boolean;
  integrationEnabled?: boolean;
  lastSyncedAt?: string | null;
  message?: string;
  connectPath?: string;
  manualSyncEligible?: boolean;
  manualSyncPending?: boolean;
  manualSyncEmail?: string | null;
  error?: string;
}> {
  const oauth = getGoogleOAuthEnvDiagnostics();
  if (!isGoogleOAuthConfigured()) {
    return {
      success: true,
      oauthConfigured: false,
      integrationEnabled: false,
      connected: false,
      hasCalendarScope: false,
      message:
        "Integração Google não configurada no servidor (AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET / AUTH_SECRET).",
      connectPath: getGoogleCalendarConnectPath(),
    };
  }

  const dbUser = await getProfessionalUser();
  if (!dbUser) {
    return { success: false, error: "Não autenticado." };
  }

  const integrationEnabled = canUseGoogleCalendarIntegration(
    dbUser.email,
    integrationOptionsForUser(dbUser),
  );
  const manualSyncEligible =
    !integrationEnabled &&
    canRequestGoogleCalendarManualSync(dbUser.plan, dbUser.email, dbUser.isInfluencer);
  const manualSyncPending =
    manualSyncEligible &&
    !!dbUser.googleCalendarManualRequestedAt &&
    !dbUser.googleCalendarManualApprovedAt;

  if (!integrationEnabled) {
    return {
      success: true,
      oauthConfigured: true,
      integrationEnabled: false,
      connected: false,
      hasCalendarScope: false,
      lastSyncedAt: null,
      message: manualSyncEligible
        ? "Conecte a conta Google para sincronizar a agenda."
        : GOOGLE_CALENDAR_INTEGRATION_ROLLOUT_MESSAGE,
      manualSyncEligible,
      manualSyncPending,
      manualSyncEmail: dbUser.googleCalendarManualEmail,
    };
  }

  const status = await resolveGoogleCalendarConnectionStatus(dbUser.id);
  const user = await prisma.user.findUnique({
    where: { id: dbUser.id },
    select: { googleCalendarLastSyncedAt: true },
  });

  return {
    success: true,
    oauthConfigured: true,
    integrationEnabled: true,
    connected: status.connected,
    hasCalendarScope: status.hasCalendarScope,
    needsReconnect: status.needsReconnect,
    lastSyncedAt: user?.googleCalendarLastSyncedAt?.toISOString() ?? null,
    message: status.message,
    connectPath: getGoogleCalendarConnectPath(),
    manualSyncEligible: false,
    manualSyncPending: false,
    manualSyncEmail: null,
  };
}

/** Período de testes: profissional Starter+ envia e-mail Google para cadastro manual pelo admin. */
export async function requestGoogleCalendarManualSync(
  googleEmail: string,
): Promise<{ success: boolean; message?: string; error?: string }> {
  const parsed = ManualGoogleEmailSchema.safeParse({ googleEmail });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "E-mail inválido." };
  }

  const dbUser = await getProfessionalUser();
  if (!dbUser) {
    return { success: false, error: "Não autenticado." };
  }

  if (
    canUseGoogleCalendarIntegration(dbUser.email, integrationOptionsForUser(dbUser))
  ) {
    return { success: false, error: "A integração Google já está disponível para sua conta." };
  }

  if (!canRequestGoogleCalendarManualSync(dbUser.plan, dbUser.email, dbUser.isInfluencer)) {
    return {
      success: false,
      error: "A integração Google Agenda está disponível nos planos Profissional e Premium.",
    };
  }

  if (
    dbUser.googleCalendarManualRequestedAt &&
    !dbUser.googleCalendarManualApprovedAt
  ) {
    return { success: true, message: GOOGLE_CALENDAR_MANUAL_SYNC_PENDING_MESSAGE };
  }

  const rateCheck = await enforceRateLimit(`gcal-manual:${dbUser.id}`, {
    maxRequests: 3,
    windowSeconds: 3600,
  });
  if (!rateCheck.allowed) {
    return {
      success: false,
      error: `Aguarde ${rateCheck.resetIn}s antes de enviar novamente.`,
    };
  }

  const normalizedGoogleEmail = parsed.data.googleEmail;
  const professionalEmail = dbUser.email?.trim() || "sem-e-mail";
  const professionalName = dbUser.name?.trim() || professionalEmail;

  await prisma.user.update({
    where: { id: dbUser.id },
    data: {
      googleCalendarManualEmail: normalizedGoogleEmail,
      googleCalendarManualRequestedAt: new Date(),
    },
  });

  const emailResult = await sendGoogleCalendarManualEnrollmentEmail({
    professionalName,
    professionalEmail,
    professionalPlan: planDisplayName(dbUser.plan),
    googleEmail: normalizedGoogleEmail,
    adminPhone: GOOGLE_CALENDAR_MANUAL_ADMIN_PHONE,
  });

  if (!emailResult.success) {
    console.error("[requestGoogleCalendarManualSync] Falha ao notificar SAC:", emailResult.error);
  }

  revalidatePath("/dashboard/agenda");

  return { success: true, message: GOOGLE_CALENDAR_MANUAL_SYNC_PENDING_MESSAGE };
}

/** Desliga Google Agenda (limpa tokens) — útil antes de gravar demo ou após revogar no Google. */
export async function disconnectGoogleCalendar(): Promise<{
  success: boolean;
  error?: string;
}> {
  const dbUser = await getProfessionalUser();
  if (!dbUser) {
    return { success: false, error: "Não autenticado." };
  }
  if (!canUseGoogleCalendarIntegration(dbUser.email, integrationOptionsForUser(dbUser))) {
    return { success: false, error: GOOGLE_CALENDAR_INTEGRATION_ROLLOUT_MESSAGE };
  }

  await invalidateGoogleOAuthAccount(dbUser.id);
  revalidatePath("/dashboard/agenda");

  return {
    success: true,
  };
}

export async function syncAppointmentToGoogleCalendar(appointmentId: string): Promise<{
  success: boolean;
  eventId?: string;
  error?: string;
}> {
  const dbUser = await getProfessionalUser();
  if (!dbUser) {
    return { success: false, error: "Não autenticado." };
  }
  if (!canUseGoogleCalendarIntegration(dbUser.email, integrationOptionsForUser(dbUser))) {
    return { success: false, error: GOOGLE_CALENDAR_INTEGRATION_ROLLOUT_MESSAGE };
  }
  try {
    const result = await syncAppointmentWithGoogleCalendar(dbUser.id, appointmentId);
    if (!result.synced || result.action === "skip") {
      return { success: false, error: result.reason ?? "Não foi possível sincronizar." };
    }
    return { success: true, eventId: result.eventId };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Erro ao sincronizar com Google Agenda.",
    };
  }
}

export async function importGoogleCalendarToAgenda(): Promise<{
  success: boolean;
  imported?: number;
  updated?: number;
  skipped?: number;
  cancelled?: number;
  errors?: string[];
  error?: string;
}> {
  const dbUser = await getProfessionalUser();
  if (!dbUser) {
    return { success: false, error: "Não autenticado." };
  }
  if (!canUseGoogleCalendarIntegration(dbUser.email, integrationOptionsForUser(dbUser))) {
    return { success: false, error: GOOGLE_CALENDAR_INTEGRATION_ROLLOUT_MESSAGE };
  }
  try {
    const result = await importEventsFromGoogleCalendar(dbUser.id);
    revalidatePath("/dashboard/agenda");
    return {
      success: true,
      imported: result.imported,
      updated: result.updated,
      skipped: result.skipped,
      cancelled: result.cancelled,
      errors: result.errors.length > 0 ? result.errors : undefined,
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Erro ao importar do Google Agenda.",
    };
  }
}

export async function runFullGoogleCalendarSync(): Promise<{
  success: boolean;
  imported?: number;
  updated?: number;
  pushed?: number;
  skipped?: number;
  errors?: string[];
  error?: string;
}> {
  const dbUser = await getProfessionalUser();
  if (!dbUser) {
    return { success: false, error: "Não autenticado." };
  }
  if (!canUseGoogleCalendarIntegration(dbUser.email, integrationOptionsForUser(dbUser))) {
    return { success: false, error: GOOGLE_CALENDAR_INTEGRATION_ROLLOUT_MESSAGE };
  }
  try {
    const result = await runGoogleCalendarBidirectionalSync(dbUser.id);
    revalidatePath("/dashboard/agenda");
    return {
      success: true,
      imported: result.import.imported,
      updated: result.import.updated,
      pushed: result.pushed,
      skipped: result.import.skipped,
      errors:
        result.import.errors.length > 0 || result.pushFailed > 0
          ? [
              ...result.import.errors,
              ...(result.pushFailed > 0
                ? [`${result.pushFailed} marcação(ões) não enviada(s) ao Google.`]
                : []),
            ]
          : undefined,
    };
  } catch (e) {
    if (e instanceof Error && e.message.includes(GOOGLE_OAUTH_REVOKED_MESSAGE)) {
      revalidatePath("/dashboard/agenda");
    }
    return {
      success: false,
      error: e instanceof Error ? e.message : "Erro na sincronização com Google Agenda.",
    };
  }
}
