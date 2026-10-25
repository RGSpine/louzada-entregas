import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { requireB2cPatientContext } from "@/lib/b2c/patient-session";
import {
  patientGoogleOAuthRedirectUri,
  verifyPatientGoogleOAuthState,
} from "@/lib/google-calendar-patient-oauth";
import { backfillPatientGoogleCalendar } from "@/lib/google-calendar-patient-sync";
import { logger } from "@/lib/logger";

const CallbackQuerySchema = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z.string().min(1).max(512).optional(),
  error: z.string().max(200).optional(),
});

function mapaUrl(request: NextRequest, query: Record<string, string>): URL {
  const url = new URL("/mapa-saude", request.url);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return url;
}

export async function GET(request: NextRequest) {
  const parsed = CallbackQuerySchema.safeParse({
    code: request.nextUrl.searchParams.get("code") ?? undefined,
    state: request.nextUrl.searchParams.get("state") ?? undefined,
    error: request.nextUrl.searchParams.get("error") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.redirect(mapaUrl(request, { google: "invalid" }));
  }

  if (parsed.data.error) {
    return NextResponse.redirect(mapaUrl(request, { google: "denied" }));
  }
  if (!parsed.data.code || !parsed.data.state) {
    return NextResponse.redirect(mapaUrl(request, { google: "invalid" }));
  }

  const state = verifyPatientGoogleOAuthState(parsed.data.state);
  if (!state.ok) {
    return NextResponse.redirect(mapaUrl(request, { google: "invalid" }));
  }

  const access = await requireB2cPatientContext();
  if (!access.ok || access.ctx.patientId !== state.patientId) {
    return NextResponse.redirect(mapaUrl(request, { google: "forbidden" }));
  }

  const clientId = process.env.AUTH_GOOGLE_ID?.trim();
  const clientSecret = process.env.AUTH_GOOGLE_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(mapaUrl(request, { google: "unconfigured" }));
  }

  const origin = new URL(request.url).origin;
  const oauth2 = new google.auth.OAuth2(
    clientId,
    clientSecret,
    patientGoogleOAuthRedirectUri(origin),
  );

  try {
    const { tokens } = await oauth2.getToken(parsed.data.code);
    if (!tokens.access_token && !tokens.refresh_token) {
      return NextResponse.redirect(mapaUrl(request, { google: "no_token" }));
    }

    const scope =
      tokens.scope ??
      "openid email profile https://www.googleapis.com/auth/calendar.events";

    await prisma.patientGoogleCalendarAccount.upsert({
      where: { patientId: access.ctx.patientId },
      create: {
        patientId: access.ctx.patientId,
        accessToken: tokens.access_token ?? null,
        refreshToken: tokens.refresh_token ?? null,
        expiresAt: tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : null,
        scope,
      },
      update: {
        accessToken: tokens.access_token ?? undefined,
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
        expiresAt: tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : undefined,
        scope,
      },
    });

    const pushed = await backfillPatientGoogleCalendar(access.ctx.patientId);
    logger.info("Google Agenda do paciente conectada", {
      feature: "google-calendar-patient",
      patientId: access.ctx.patientId,
      pushed,
    });

    return NextResponse.redirect(
      mapaUrl(request, { google: "patient_connected", pushed: String(pushed) }),
    );
  } catch (err) {
    logger.warn("Callback Google Agenda do paciente falhou", {
      feature: "google-calendar-patient",
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.redirect(mapaUrl(request, { google: "failed" }));
  }
}
