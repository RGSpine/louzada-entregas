import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { enforceRateLimit, JOB_POLL_RATE_LIMIT } from "@/lib/rate-limit";
import { maybeKickStaleQueuedEvolutionJob } from "@/lib/evolution-job-worker";
import { prisma } from "@/lib/prisma";
import { getEvolutionJobForUser } from "@/server/services/evolution-jobs";

type RouteParams = {
  params: Promise<{ jobId: string }>;
};

/** Somente leitura de estado/resultado; o processamento corre no worker `/api/cron/evolution-jobs`. */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { jobId } = await params;

    const supabase = await createSupabaseServerClient();
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !authUser?.email) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    const dbUser = await prisma.user.findFirst({
      where: { OR: [{ authUserId: authUser.id }, { email: authUser.email }] },
      select: { id: true },
    });
    if (!dbUser?.id) {
      return NextResponse.json({ error: "Utilizador não encontrado." }, { status: 404 });
    }

    const rl = await enforceRateLimit(`job-poll:${authUser.email}`, JOB_POLL_RATE_LIMIT);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Muitas consultas. Tente em ${rl.resetIn}s.` },
        { status: 429 },
      );
    }

    const job = await getEvolutionJobForUser(jobId, dbUser.id);
    if (!job.ok) {
      const status = job.reason === "invalid_id" ? 400 : 404;
      return NextResponse.json({ error: job.message }, { status });
    }

    if (job.payload.status === "QUEUED" || job.payload.status === "PROCESSING") {
      maybeKickStaleQueuedEvolutionJob(job.jobId, job.payload.status, job.createdAt);
    }

    return NextResponse.json(job.payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Erro ao consultar job.",
      },
      { status: 500 },
    );
  }
}
