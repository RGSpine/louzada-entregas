import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { RouteJobIdSchema } from "@/lib/api-schemas";
import { enforceRateLimit, JOB_POLL_RATE_LIMIT } from "@/lib/rate-limit";
import { canUseOfficeFinance } from "@/lib/plan-limits";
import { OFFICE_FINANCE_PLAN_ERROR } from "@/lib/office-finance-access";

type RouteParams = {
  params: Promise<{ jobId: string }>;
};

/** Leitura do estado da extração IA (sem disparar Gemini). Worker: mesmo cron que `/api/cron/evolution-jobs`. */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { jobId: rawJobId } = await params;
    const paramsParsed = RouteJobIdSchema.safeParse({ jobId: rawJobId });
    if (!paramsParsed.success) {
      return NextResponse.json({ error: "ID de job inválido." }, { status: 400 });
    }
    const { jobId } = paramsParsed.data;

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
      select: { id: true, plan: true, email: true, isInfluencer: true },
    });
    if (!dbUser?.id) {
      return NextResponse.json({ error: "Utilizador não encontrado." }, { status: 404 });
    }

    if (!canUseOfficeFinance(dbUser.plan, dbUser.email, dbUser.isInfluencer)) {
      return NextResponse.json({ error: OFFICE_FINANCE_PLAN_ERROR }, { status: 403 });
    }

    const rl = await enforceRateLimit(`job-poll:${authUser.email}`, JOB_POLL_RATE_LIMIT);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Muitas consultas. Tente em ${rl.resetIn}s.` },
        { status: 429 },
      );
    }

    const row = await prisma.officeFinanceExtractionJob.findFirst({
      where: { id: jobId, userId: dbUser.id },
      select: {
        status: true,
        resultData: true,
        errorMessage: true,
        finishedAt: true,
        startedAt: true,
        createdAt: true,
      },
    });

    if (!row) {
      return NextResponse.json({ error: "Job não encontrado." }, { status: 404 });
    }

    if (row.status === "SUCCEEDED") {
      return NextResponse.json({
        status: row.status,
        result: row.resultData,
        finishedAt: row.finishedAt,
      });
    }

    if (row.status === "FAILED") {
      return NextResponse.json({
        status: row.status,
        error: row.errorMessage || "Falha ao processar extração.",
        finishedAt: row.finishedAt,
      });
    }

    return NextResponse.json({
      status: row.status,
      startedAt: row.startedAt,
      createdAt: row.createdAt,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Erro ao consultar job.",
      },
      { status: 500 },
    );
  }
}
