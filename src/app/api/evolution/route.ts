import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  aiBillingRateLimitMessage,
  enforceAiBillingRateLimit,
} from "@/lib/ai-billing-rate-limit";
import { getRequestClientIp } from "@/lib/request-client-ip";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { processEvolutionFormData } from "@/server/services/evolution-process";

/**
 * Segment config do Next precisa de literal estático.
 * Mantido em 300s para compatibilidade com build/deploy.
 */
export const maxDuration = 300;

function mapProcessResultToLegacyResponse(
  result: Awaited<ReturnType<typeof processEvolutionFormData>>,
) {
  switch (result.kind) {
    case "error":
      return NextResponse.json({ error: result.message }, { status: result.httpStatus });
    case "async":
      return NextResponse.json(
        {
          async: true,
          jobId: result.jobId,
          status: result.status,
          createdAt: result.createdAt,
        },
        { status: 202 },
      );
    case "revision":
    case "sync":
      return NextResponse.json(result.body);
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !authUser?.email) {
      logger.warn("API evolution: acesso não autenticado bloqueado", { feature: "api/evolution" });
      return NextResponse.json(
        { error: "Não autenticado. Faça login para continuar." },
        { status: 401 },
      );
    }

    const rateLimitResult = await enforceAiBillingRateLimit({
      userKey: authUser.email.toLowerCase(),
      ip: getRequestClientIp(request.headers),
    });
    if (!rateLimitResult.allowed) {
      logger.warn("API evolution: rate limit excedido", {
        feature: "api/evolution",
        email: authUser.email.slice(0, 3) + "***",
      });
      return NextResponse.json(
        { error: aiBillingRateLimitMessage(rateLimitResult.resetIn) },
        { status: 429 },
      );
    }

    const dbUser = await prisma.user.findFirst({
      where: { OR: [{ authUserId: authUser.id }, { email: authUser.email }] },
      select: { id: true },
    });

    const formData = await request.formData();
    const result = await processEvolutionFormData(
      { id: authUser.id, email: authUser.email },
      dbUser?.id ?? null,
      formData,
    );

    return mapProcessResultToLegacyResponse(result);
  } catch (error) {
    console.error("❌ [ERRO] na rota /api/evolution:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Erro desconhecido ao processar evolução",
      },
      { status: 500 },
    );
  }
}
