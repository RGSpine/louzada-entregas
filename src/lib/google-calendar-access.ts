import { prisma } from "@/lib/prisma";
import { isPlatformOwnerEmail } from "@/lib/plan-limits";
import { comparePlanTiers, normalizePlanTier } from "@/lib/plan-tier";
import { isGoogleAuthAllowlistedEmail } from "@/lib/auth/google-auth-allowlist";

/** Mensagem exibida na agenda enquanto a integração Google está em rollout restrito. */
export const GOOGLE_CALENDAR_INTEGRATION_ROLLOUT_MESSAGE =
  "A ligação com o Google Agenda ainda está em fase de testes internos. Em breve estará disponível para todos os profissionais.";

/** Mensagem após o profissional enviar o e-mail Google para cadastro manual. */
export const GOOGLE_CALENDAR_MANUAL_SYNC_PENDING_MESSAGE =
  "A sincronização será feita em até 12hrs.";

export const GOOGLE_CALENDAR_MANUAL_ADMIN_PHONE = "+5516992756619";

type GoogleCalendarAccessOptions = {
  googleCalendarManualApprovedAt?: Date | null;
};

/**
 * OAuth Google Calendar liberado para o dono da plataforma, para as contas de teste
 * da allowlist Google e para profissionais aprovados manualmente.
 */
export function canUseGoogleCalendarIntegration(
  email: string | null | undefined,
  options?: GoogleCalendarAccessOptions,
): boolean {
  if (isPlatformOwnerEmail(email)) return true;
  if (isGoogleAuthAllowlistedEmail(email)) return true;
  if (options?.googleCalendarManualApprovedAt) return true;
  return false;
}

/** Plano Profissional ou superior (inclui Clínica) pode solicitar cadastro manual. */
export function canRequestGoogleCalendarManualSync(
  storedPlan: string | null | undefined,
  email?: string | null,
  isInfluencer?: boolean,
): boolean {
  if (isPlatformOwnerEmail(email)) return false;
  if (isGoogleAuthAllowlistedEmail(email)) return false;
  if (isInfluencer) return true;
  const tier = normalizePlanTier(storedPlan);
  if (!tier) return false;
  return comparePlanTiers(tier, "PROFISSIONAL") >= 0;
}

export async function isGoogleCalendarIntegrationEnabledForUser(
  userId: string,
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, googleCalendarManualApprovedAt: true },
  });
  return canUseGoogleCalendarIntegration(user?.email, {
    googleCalendarManualApprovedAt: user?.googleCalendarManualApprovedAt,
  });
}
