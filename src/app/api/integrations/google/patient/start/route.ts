import { NextRequest, NextResponse } from "next/server";
import { requireB2cPatientContext } from "@/lib/b2c/patient-session";
import { buildPatientGoogleOAuthUrl } from "@/lib/google-calendar-patient-oauth";
import { isGoogleOAuthConfigured } from "@/lib/google-oauth-link";
import { enforceRateLimit } from "@/lib/rate-limit";

function mapaUrl(request: NextRequest, query?: Record<string, string>): URL {
  const url = new URL("/mapa-saude", request.url);
  if (query) {
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  }
  return url;
}

/** Inicia OAuth Google Calendar da conta do paciente (não cria User profissional). */
export async function GET(request: NextRequest) {
  if (!isGoogleOAuthConfigured()) {
    return NextResponse.redirect(mapaUrl(request, { google: "unconfigured" }));
  }

  const access = await requireB2cPatientContext();
  if (!access.ok) {
    const login = new URL("/paciente/login", request.url);
    login.searchParams.set("redirect", "/mapa-saude");
    return NextResponse.redirect(login);
  }

  const rl = await enforceRateLimit(`patient-gcal:${access.ctx.patientId}`, {
    maxRequests: 8,
    windowSeconds: 60,
  });
  if (!rl.allowed) {
    return NextResponse.redirect(mapaUrl(request, { google: "rate_limited" }));
  }

  const origin = new URL(request.url).origin;
  const target = buildPatientGoogleOAuthUrl({
    origin,
    patientId: access.ctx.patientId,
  });
  return NextResponse.redirect(target);
}
