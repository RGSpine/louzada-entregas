import { NextRequest, NextResponse } from "next/server";
import {
  listPatientExams,
  uploadPatientExam,
  deletePatientExam,
} from "@/app/actions/patient-exams";

function statusForActionError(error: string | undefined, success: boolean): number {
  if (success) return 200;
  const e = (error || "").toLowerCase();
  if (e.includes("não autenticado") || e.includes("autenticado")) return 401;
  if (e.includes("pro") || e.includes("plano")) return 403;
  if (
    e.includes("parâmetro") ||
    e.includes("inválido") ||
    e.includes("selecione") ||
    e.includes("tipo não permitido") ||
    e.includes("grande")
  ) {
    return 400;
  }
  if (e.includes("não encontrado") || e.includes("acesso negado")) return 404;
  return 400;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ patientId: string }> }
) {
  const { patientId } = await params;
  const result = await listPatientExams(patientId);
  const status = result.success ? 200 : statusForActionError(result.error, false);
  return NextResponse.json(result, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ patientId: string }> }
) {
  try {
    const { patientId } = await params;
    const incoming = await request.formData();
    incoming.set("patientId", patientId);
    const result = await uploadPatientExam(incoming);
    const status = result.success
      ? 201
      : statusForActionError(result.error, false);
    return NextResponse.json(result, { status });
  } catch (error) {
    console.error("[POST /api/patients/.../exams]", error);
    return NextResponse.json(
      { success: false, error: "Erro ao processar upload." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ patientId: string }> }
) {
  await params;
  const examId = new URL(request.url).searchParams.get("id");
  if (!examId?.trim()) {
    return NextResponse.json(
      { success: false, error: "Parâmetro 'id' do exame é obrigatório." },
      { status: 400 }
    );
  }
  const result = await deletePatientExam(examId);
  const status = result.success ? 200 : statusForActionError(result.error, false);
  return NextResponse.json(result, { status });
}
