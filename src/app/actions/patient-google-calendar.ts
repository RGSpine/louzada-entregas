"use server";

import { prisma } from "@/lib/prisma";
import { requireB2cPatientContext } from "@/lib/b2c/patient-session";
import { scopeIncludesGoogleCalendar } from "@/lib/google-oauth-link";

export type PatientGoogleCalendarStatus =
  | {
      success: true;
      connected: boolean;
      hasCalendarScope: boolean;
      connectPath: string;
    }
  | { success: false; error: string };

export async function getPatientGoogleCalendarStatus(): Promise<PatientGoogleCalendarStatus> {
  const access = await requireB2cPatientContext();
  if (!access.ok) return { success: false, error: access.error };

  const account = await prisma.patientGoogleCalendarAccount.findUnique({
    where: { patientId: access.ctx.patientId },
    select: { accessToken: true, refreshToken: true, scope: true },
  });

  const connected = Boolean(account?.refreshToken || account?.accessToken);
  return {
    success: true,
    connected,
    hasCalendarScope: connected && scopeIncludesGoogleCalendar(account?.scope),
    connectPath: "/api/integrations/google/patient/start",
  };
}

export async function disconnectPatientGoogleCalendar(): Promise<
  { success: true } | { success: false; error: string }
> {
  const access = await requireB2cPatientContext();
  if (!access.ok) return { success: false, error: access.error };

  await prisma.patientGoogleCalendarAccount.deleteMany({
    where: { patientId: access.ctx.patientId },
  });
  return { success: true };
}
