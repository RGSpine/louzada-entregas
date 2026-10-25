import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { enforceRateLimit, API_V1_READ_RATE_LIMIT } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { listRecoverableEvolutionJobsForUser } from "@/server/services/evolution-jobs";

/** Jobs de evolução por áudio recuperáveis (QUEUED / PROCESSING / SUCCEEDED recente). */
export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !authUser?.email) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    const rl = await enforceRateLimit(`evolution-jobs-active:${authUser.email}`, API_V1_READ_RATE_LIMIT);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Muitas consultas. Tente em ${rl.resetIn}s.` },
        { status: 429 },
      );
    }

    const dbUser = await prisma.user.findFirst({
      where: { OR: [{ authUserId: authUser.id }, { email: authUser.email }] },
      select: { id: true },
    });
    if (!dbUser?.id) {
      return NextResponse.json({ jobs: [] });
    }

    const jobs = await listRecoverableEvolutionJobsForUser(dbUser.id);
    return NextResponse.json({ jobs });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Erro ao listar jobs.",
      },
      { status: 500 },
    );
  }
}
