import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, API_V1_WRITE_RATE_LIMIT } from "@/lib/rate-limit";
import { createAppointmentForUser } from "@/server/services/appointments";
import { getPatientAccessScope } from "@/lib/intra-user/patient-access";

export const maxDuration = 60;

/**
 * Cria marcação via cookie auth (web + PWA).
 * Route Handler é mais fiável que Server Action no Safari/iOS PWA.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !authUser?.email) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const rl = await enforceRateLimit(`agenda-create:${authUser.email}`, API_V1_WRITE_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Muitas requisições. Tente em ${rl.resetIn}s.` },
      { status: 429 },
    );
  }

  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [{ authUserId: authUser.id }, { email: authUser.email }],
    },
    select: { id: true },
  });

  if (!dbUser) {
    return NextResponse.json({ error: "Utilizador não encontrado." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo JSON inválido." }, { status: 400 });
  }

  const scope = await getPatientAccessScope();
  if (!scope || scope.denied) {
    return NextResponse.json(
      { error: "Selecione o perfil profissional para continuar." },
      { status: 403 },
    );
  }
  const result = await createAppointmentForUser(dbUser.id, body, {
    attendingIntraUserId: scope.activeIntraUser?.id ?? null,
    activeIntraUser: scope.activeIntraUser ?? null,
  });
  if (!result.success) {
    return NextResponse.json(
      {
        error: result.error,
        suggestedSlots: result.suggestedSlots,
      },
      { status: result.suggestedSlots ? 409 : 400 },
    );
  }

  return NextResponse.json(
    {
      success: true,
      id: result.data?.id,
      createdPatient: result.createdPatient ?? false,
      createdCount: result.data?.createdCount ?? 1,
      seriesId: result.data?.seriesId ?? null,
    },
    { status: 201 },
  );
}
