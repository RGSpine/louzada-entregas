import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { MetricsShareSchema, RoutePatientIdSchema } from "@/lib/api-schemas";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ patientId: string }> }
) {
  try {
    const { patientId: rawPatientId } = await params;
    const paramsParsed = RoutePatientIdSchema.safeParse({ patientId: rawPatientId });
    if (!paramsParsed.success) {
      return NextResponse.json({ success: false, error: "ID de paciente inválido." }, { status: 400 });
    }
    const { patientId } = paramsParsed.data;

    const supabase = await createSupabaseServerClient();
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !authUser?.email) {
      return NextResponse.json({ success: false, error: "Não autenticado." }, { status: 401 });
    }

    const rawBody = await request.json().catch(() => null);
    const parsed = MetricsShareSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Dados inválidos.", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const body = parsed.data;

    const format = body.format === "jpeg" ? "jpeg" : "png";
    const mimeOk = format === "png" ? "image/png" : "image/jpeg";

    if (!body.imageDataUrl.startsWith(`data:${mimeOk};base64,`)) {
      return NextResponse.json(
        { success: false, error: `Formato inválido. Esperado ${mimeOk}.` },
        { status: 400 },
      );
    }

    const base64 = body.imageDataUrl.split(",")[1] ?? "";
    const approxBytes = Math.floor((base64.length * 3) / 4);
    const MAX_BYTES = 8 * 1024 * 1024;
    if (!base64 || approxBytes > MAX_BYTES) {
      return NextResponse.json(
        { success: false, error: "Imagem muito grande para compartilhamento." },
        { status: 413 },
      );
    }

    const dbUser = await prisma.user.findFirst({
      where: { OR: [{ authUserId: authUser.id }, { email: authUser.email ?? "" }] },
      select: { id: true },
    });

    if (!dbUser) {
      return NextResponse.json({ success: false, error: "Usuário não encontrado." }, { status: 404 });
    }

    const patient = await prisma.patient.findFirst({
      where: { id: patientId, userId: dbUser.id },
      select: { id: true },
    });

    if (!patient) {
      return NextResponse.json(
        { success: false, error: "Paciente não encontrado ou não pertence a você." },
        { status: 404 }
      );
    }

    const buffer = Buffer.from(base64, "base64");

    const supabaseAdmin = createSupabaseAdminClient();

    const ext = format === "jpeg" ? "jpg" : "png";
    const sharePath = `visual-metrics-share/${dbUser.id}/${patientId}/${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}.${ext}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from("images")
      .upload(sharePath, buffer, {
        contentType: mimeOk,
        upsert: false,
      });

    if (uploadError) {
      if (uploadError.message.includes("Bucket") || uploadError.message.includes("not found")) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Bucket 'images' não encontrado no Supabase Storage. Crie o bucket para usar export/compartilhamento.",
          },
          { status: 500 }
        );
      }

      return NextResponse.json(
        { success: false, error: `Erro ao fazer upload da imagem: ${uploadError.message}` },
        { status: 500 }
      );
    }

    const { data: publicUrlData } = supabaseAdmin.storage
      .from("images")
      .getPublicUrl(sharePath);

    return NextResponse.json({ success: true, url: publicUrlData.publicUrl });
  } catch (error) {
    console.error("[metrics/share] Erro:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Erro inesperado ao compartilhar imagem.",
      },
      { status: 500 }
    );
  }
}

