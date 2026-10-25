import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  isPatientExamFileUrlTrusted,
  verifyPatientExamShareToken,
} from "@/lib/document-share-link";
import {
  enforceRateLimit,
  DOCUMENT_SHARE_REDIRECT_RATE_LIMIT,
} from "@/lib/rate-limit";

function clientIp(request: NextRequest): string {
  const xf = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (xf) return xf;
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "unknown";
}

/**
 * Redireccionamento seguro para o PDF no Storage: token HMAC + validação de URL no servidor.
 * Não expõe redirect aberto: só URLs do bucket `patient-exams` do projecto configurado.
 */
export async function GET(request: NextRequest) {
  const ip = clientIp(request);
  const rl = await enforceRateLimit(`doc-share:${ip}`, DOCUMENT_SHARE_REDIRECT_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Muitas tentativas. Tente mais tarde." },
      { status: 429 }
    );
  }

  const token = request.nextUrl.searchParams.get("t")?.trim();
  if (!token || token.length > 2048) {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const parsed = verifyPatientExamShareToken(token);
  if (!parsed) {
    return NextResponse.json(
      { error: "Link inválido ou expirado." },
      { status: 400 }
    );
  }

  const exam = await prisma.patientExam.findUnique({
    where: { id: parsed.examId },
    select: { fileUrl: true },
  });

  if (!exam?.fileUrl) {
    return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });
  }

  if (!isPatientExamFileUrlTrusted(exam.fileUrl)) {
    console.error(
      "[document-share] URL fora do armazenamento permitido:",
      exam.fileUrl.slice(0, 96)
    );
    return NextResponse.json({ error: "Não autorizado." }, { status: 400 });
  }

  const res = NextResponse.redirect(exam.fileUrl, 302);
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.headers.set("Pragma", "no-cache");
  return res;
}
