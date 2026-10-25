import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { enforceRateLimit, API_V1_WRITE_RATE_LIMIT } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  SignUploadSchema,
  createDirectUploadSignedUrl,
} from "@/lib/uploads/direct-upload";

/**
 * Signed upload URL para o dashboard web (sessão Supabase cookie).
 * Path isolado por utilizador — mesmo contrato que `/api/v1/uploads/sign`.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !authUser?.email) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    const rl = await enforceRateLimit(`upload-sign:${authUser.email}`, API_V1_WRITE_RATE_LIMIT);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Muitas requisições. Tente em ${rl.resetIn}s.` },
        { status: 429 },
      );
    }

    const dbUser = await prisma.user.findFirst({
      where: { OR: [{ authUserId: authUser.id }, { email: authUser.email }] },
      select: { id: true },
    });
    if (!dbUser?.id) {
      return NextResponse.json(
        { error: "Conta sem registro local — upload indisponível." },
        { status: 400 },
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: "Body JSON inválido." }, { status: 400 });
    }

    const parsed = SignUploadSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: parsed.error.issues.map((i) => i.message).join("; "),
        },
        { status: 400 },
      );
    }

    const result = await createDirectUploadSignedUrl(dbUser.id, parsed.data);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.httpStatus });
    }

    return NextResponse.json(result.data);
  } catch (error) {
    logger.error("API uploads/sign: erro inesperado", {
      feature: "api/uploads/sign",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Erro ao gerar URL de upload." }, { status: 500 });
  }
}
