"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireB2cPatientContext } from "@/lib/b2c/patient-session";
import { bookAgendaOpeningForPatient } from "@/lib/marketplace/showcase-agenda";
import { enforceRateLimit } from "@/lib/rate-limit";

const bookSchema = z.object({
  profileId: z.string().trim().min(1).max(80),
  startAt: z.string().datetime(),
});

/** Paciente logado marca um horário livre da agenda, quando o profissional autorizou. */
export async function bookShowcaseAgendaOpening(
  raw: unknown,
): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = bookSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: "Horário inválido." };
  }
  const access = await requireB2cPatientContext();
  if (!access.ok) {
    return { success: false, error: "Entre na sua conta de paciente para marcar." };
  }
  const rl = await enforceRateLimit(`showcase-agenda-book:${access.ctx.patientId}`, {
    maxRequests: 8,
    windowSeconds: 3600,
  });
  if (!rl.allowed) {
    return { success: false, error: `Muitas marcações. Tente em ${rl.resetIn}s.` };
  }

  const result = await bookAgendaOpeningForPatient({
    profileId: parsed.data.profileId,
    startAt: new Date(parsed.data.startAt),
    patientId: access.ctx.patientId,
    patientName: access.ctx.patientName,
    email: access.ctx.email,
    phone: access.ctx.phone,
  });
  if (!result.success) return result;
  revalidatePath("/vitrine");
  revalidatePath("/dashboard/agenda");
  return { success: true };
}
