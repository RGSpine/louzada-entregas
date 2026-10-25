import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";

/**
 * Top 5 nomes de métrica mais usados pelo profissional autenticado
 * (via pacientes dele). Não aceita userId na query — só o utilizador da sessão.
 */
export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !authUser) {
      return NextResponse.json(
        { success: false, error: "Não autenticado." },
        { status: 401 }
      );
    }

    const dbUser = await prisma.user.findFirst({
      where: {
        OR: [{ authUserId: authUser.id }, { email: authUser.email ?? "" }],
      },
      select: { id: true },
    });

    if (!dbUser) {
      return NextResponse.json(
        { success: false, error: "Usuário não encontrado." },
        { status: 404 }
      );
    }

    const grouped = await prisma.patientMetric.groupBy({
      by: ["name"],
      where: {
        patient: { userId: dbUser.id },
      },
      _count: { id: true },
    });

    const sorted = [...grouped].sort((a, b) => b._count.id - a._count.id);
    const suggestions = sorted.slice(0, 5).map((g) => g.name);

    return NextResponse.json({ success: true, suggestions });
  } catch (error) {
    console.error("[GET /api/metrics/suggestions]", error);
    return NextResponse.json(
      {
        success: false,
        error: "Erro ao carregar sugestões de métricas.",
      },
      { status: 500 }
    );
  }
}
