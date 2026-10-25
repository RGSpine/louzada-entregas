"use server";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import { enforceRateLimit, SIGNUP_RATE_LIMIT } from "@/lib/rate-limit";
import { firstZodError } from "@/lib/marketplace/schemas";
import { safeMarketplaceRedirect } from "@/lib/marketplace/paths";
import { registerB2cPatientSchema } from "@/lib/b2c/schemas";
import { ensureB2cPatientAndPrimaryProfile } from "@/lib/b2c/patient-session";
import { isMapInviteToken, redeemMapInviteForAuthUser } from "@/lib/b2c/professional-link";
import { clearMapInviteCookie, readMapInviteToken } from "@/lib/b2c/map-invite-cookie";

export type RegisterMarketplacePatientResult =
  | { success: true; redirectTo: string; needsEmailConfirmation: boolean }
  | { success: false; error: string };

export async function registerMarketplacePatient(
  raw: unknown,
): Promise<RegisterMarketplacePatientResult> {
  const parsed = registerB2cPatientSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error) };
  }

  const email = parsed.data.email.toLowerCase();
  const rl = await enforceRateLimit(`marketplace-signup:${email}`, SIGNUP_RATE_LIMIT);
  if (!rl.allowed) {
    return { success: false, error: `Muitas tentativas. Tente em ${rl.resetIn}s.` };
  }

  const name = sanitizeText(parsed.data.name).slice(0, 200) || "Paciente";
  const phone = parsed.data.phone ?? null;
  let dateOfBirth: Date | null = null;
  if (parsed.data.dateOfBirth) {
    const birth = new Date(`${parsed.data.dateOfBirth}T12:00:00.000Z`);
    if (Number.isNaN(birth.getTime()) || birth.getTime() > Date.now()) {
      return { success: false, error: "Data de nascimento inválida." };
    }
    dateOfBirth = birth;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password: parsed.data.password,
    options: {
      data: {
        full_name: name,
        audience: "patient",
        ...(phone ? { phone } : {}),
      },
    },
  });

  if (error || !data.user) {
    const message = error?.message ?? "";
    if (message.toLowerCase().includes("already registered")) {
      return {
        success: false,
        error: "Este e-mail já possui conta. Entre para continuar.",
      };
    }
    return { success: false, error: "Não foi possível criar a conta." };
  }

  try {
    await prisma.patient.upsert({
      where: { authUserId: data.user.id },
      update: {
        name,
        email,
        ...(phone ? { phone } : {}),
        ...(dateOfBirth ? { dateOfBirth } : {}),
      },
      create: {
        authUserId: data.user.id,
        name,
        email,
        phone,
        dateOfBirth,
      },
    });
    await ensureB2cPatientAndPrimaryProfile(data.user);
  } catch {
    return {
      success: false,
      error: "Conta criada, mas o perfil do paciente falhou. Entre e tente de novo.",
    };
  }

  const inviteToken =
    parsed.data.inviteToken && isMapInviteToken(parsed.data.inviteToken)
      ? parsed.data.inviteToken
      : await readMapInviteToken();
  if (inviteToken) {
    try {
      const linked = await redeemMapInviteForAuthUser(data.user.id, inviteToken);
      if (linked) await clearMapInviteCookie();
    } catch {
      // A conta fica válida. O login seguinte tenta o convite de novo.
    }
  }

  return {
    success: true,
    redirectTo: safeMarketplaceRedirect(parsed.data.redirect) ?? "/mapa-saude",
    needsEmailConfirmation: !data.session,
  };
}
