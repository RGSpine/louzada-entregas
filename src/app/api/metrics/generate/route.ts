import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getGeminiModel, isGeminiConfigured, GEMINI_MODEL } from "@/lib/gemini";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import {
  canAnalyzeImages,
  canUsePatientExamFolder,
  isStarterOrAbove,
} from "@/lib/plan-limits";
import {
  aiBillingRateLimitMessage,
  enforceAiBillingRateLimit,
} from "@/lib/ai-billing-rate-limit";
import { getRequestClientIp } from "@/lib/request-client-ip";
import { clinicalGenerationConfig } from "@/lib/clinical-harness";

const MetricsGenerateSchema = z.object({
  patientId: z.string().uuid("patientId deve ser um UUID válido"),
  inputType: z.enum(["text", "file"], { error: "inputType deve ser 'text' ou 'file'" }),
  data: z.string().min(1, "data não pode ser vazio"),
  requestedMetrics: z.array(z.string().max(100)).max(20).optional().default([]),
  mimeType: z.string().max(100).optional(),
  fileName: z.string().max(255).optional(),
  referenceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "referenceDate deve estar no formato AAAA-MM-DD")
    .optional(),
});

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const MAX_FILE_BYTES = 8 * 1024 * 1024;

/** Skill (system instruction) — Evolução Visual / extração estruturada. */
const VISUAL_METRICS_SKILL = `ROLE: Perito em Análise de Dados Clínicos e Reabilitação.

TAREFA: Ler o input (texto de evolução clínica OU imagem/PDF de exame ou questionário) e extrair métricas quantificáveis: notas em escalas (ex.: EVA 0–10) ou valores absolutos com unidades clínicas (graus, kg, pontuação total de instrumento, etc.).

CONTEXTO DE MÉTRICAS: Priorize extrair e rotar nomes alinhados à lista de "Métricas Solicitadas" fornecida no pedido. Se essa lista estiver vazia, identifique automaticamente até 3 métricas mais relevantes e clinicamente justificadas a partir do conteúdo (ex.: Nível de Dor, Amplitude de Movimento, Força Muscular, função, adesão).

PADRONIZAÇÃO DE DOR: Se houver linguagem subjetiva sobre dor ("melhorou um pouco", "piorou muito", "quase sem dor"), converta para valor na Escala Visual Analógica (EVA 0–10), usando o contexto clínico para calibrar; indique unit "EVA" e explique no reasoning.

OUTPUT: Responda EXCLUSIVAMENTE com um array JSON válido (sem markdown, sem comentários), no formato exato:
[{"name": "Nome da Métrica", "value": 8.5, "unit": "EVA|Graus|kg|pontos|etc", "date": "AAAA-MM-DD", "reasoning": "Breve explicação da extração"}]

Regras adicionais:
- Use "date" coerente com o documento ou texto; se não houver data explícita, use a data indicada no pedido pelo sistema.
- Não invente valores que não tenham base no input.
- "value" deve ser número finito.
- Máximo 8 métricas no array.`;

function sanitizeFileName(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
  return base.length > 0 ? base : "arquivo";
}

type MetricRow = {
  name: string;
  value: number;
  unit: string;
  date: string;
  reasoning: string;
};

function parseMetricsJson(text: string): MetricRow[] {
  let t = text.trim().replace(/```json\n?/gi, "").replace(/```\n?/g, "").trim();
  const arrMatch = t.match(/\[[\s\S]*\]/);
  if (arrMatch) t = arrMatch[0];
  const parsed = JSON.parse(t) as unknown;
  if (!Array.isArray(parsed)) return [];
  const out: MetricRow[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    const value = typeof o.value === "number" ? o.value : Number(o.value);
    const unit = typeof o.unit === "string" ? o.unit.trim() : "";
    const date = typeof o.date === "string" ? o.date.split("T")[0]!.trim() : "";
    const reasoning = typeof o.reasoning === "string" ? o.reasoning.trim() : "";
    if (!name || !Number.isFinite(value) || !date) continue;
    out.push({
      name,
      value: Math.max(-1e7, Math.min(1e7, value)),
      unit: unit || "—",
      date,
      reasoning: reasoning.slice(0, 8000),
    });
  }
  return out;
}

async function resolveDbUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !authUser) {
    return { error: "Não autenticado.", status: 401 as const };
  }

  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [{ authUserId: authUser.id }, { email: authUser.email ?? "" }],
    },
    select: {
      id: true,
      plan: true,
      email: true,
      isInfluencer: true,
    },
  });

  if (!dbUser) {
    return { error: "Usuário não encontrado.", status: 404 as const };
  }

  return { dbUser, authUser };
}

export async function POST(request: NextRequest) {
  try {
    if (!isGeminiConfigured()) {
      return NextResponse.json(
        {
          success: false,
          error:
            "GEMINI_API_KEY não configurada. Defina a chave da API Gemini no .env para usar a geração inteligente.",
        },
        { status: 503 }
      );
    }

    const rawBody = await request.json().catch(() => null);
    if (!rawBody || typeof rawBody !== "object") {
      return NextResponse.json(
        { success: false, error: "Corpo da requisição inválido ou ausente." },
        { status: 400 }
      );
    }

    const parsed = MetricsGenerateSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues.map((i) => i.message).join("; ") },
        { status: 400 }
      );
    }
    const body = parsed.data;

    const userRes = await resolveDbUser();
    if ("error" in userRes) {
      return NextResponse.json(
        { success: false, error: userRes.error },
        { status: userRes.status }
      );
    }
    const { dbUser, authUser } = userRes;

    const rl = await enforceAiBillingRateLimit({
      userKey: authUser.email.toLowerCase(),
      ip: getRequestClientIp(request.headers),
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: aiBillingRateLimitMessage(rl.resetIn) },
        { status: 429 }
      );
    }

    const patient = await prisma.patient.findFirst({
      where: { id: body.patientId, userId: dbUser.id },
      select: { id: true, name: true },
    });

    if (!patient) {
      return NextResponse.json(
        { success: false, error: "Paciente não encontrado ou acesso negado." },
        { status: 404 }
      );
    }

    const requestedMetrics = body.requestedMetrics.map((x) => x.trim()).filter(Boolean);

    const referenceDate = body.referenceDate ?? new Date().toISOString().split("T")[0]!;

    if (body.inputType === "file") {
      if (!canAnalyzeImages(dbUser.plan, dbUser.email, dbUser.isInfluencer)) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Análise multimodal de exames requer plano PREMIUM (ou conta autorizada).",
          },
          { status: 403 }
        );
      }
      if (!canUsePatientExamFolder(dbUser.plan, dbUser.email, dbUser.isInfluencer)) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Armazenar o exame na pasta do paciente requer plano PREMIUM (Pasta de Exames).",
          },
          { status: 403 }
        );
      }
    } else {
      if (!isStarterOrAbove(dbUser.plan, dbUser.email, dbUser.isInfluencer)) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Geração de métricas a partir de texto requer plano Profissional ou Premium.",
          },
          { status: 403 }
        );
      }
    }

    const model = getGeminiModel({
      systemInstruction: VISUAL_METRICS_SKILL,
      generationConfig: clinicalGenerationConfig(),
    });

    let patientExamId: string | null = null;

    let userPrompt = `Paciente: ${patient.name}
Data de referência do sistema (use se não houver data clara no input): ${referenceDate}
Métricas solicitadas (prioridade; pode estar vazio): ${JSON.stringify(requestedMetrics)}

`;

    const multimodalParts: (
      | { text: string }
      | { inlineData: { mimeType: string; data: string } }
    )[] = [];

    if (body.inputType === "text") {
      userPrompt += `Tipo de input: TEXTO CLÍNICO / EVOLUÇÃO\n\n---\n${body.data.slice(0, 120_000)}\n---\n\nExtraia o array JSON conforme a skill.`;
      multimodalParts.push({ text: userPrompt });
    } else {
      const mime =
        typeof body.mimeType === "string" && ALLOWED_MIME.has(body.mimeType)
          ? body.mimeType
          : "application/octet-stream";
      if (mime === "application/octet-stream") {
        return NextResponse.json(
          {
            success: false,
            error:
              "mimeType inválido ou não permitido. Use PDF ou imagem (JPEG, PNG, WebP, GIF).",
          },
          { status: 400 }
        );
      }

      let buffer: Buffer;
      try {
        buffer = Buffer.from(body.data, "base64");
      } catch {
        return NextResponse.json(
          { success: false, error: "Base64 do ficheiro inválido." },
          { status: 400 }
        );
      }
      if (buffer.length === 0 || buffer.length > MAX_FILE_BYTES) {
        return NextResponse.json(
          {
            success: false,
            error: "Ficheiro vazio ou acima do limite (8 MB).",
          },
          { status: 400 }
        );
      }

      const safeName = sanitizeFileName(body.fileName || "exame");
      const objectPath = `${dbUser.id}/${body.patientId}/${Date.now()}-viz-${safeName}`;

      const supabaseAdmin = createSupabaseAdminClient();
      const { error: upErr } = await supabaseAdmin.storage
        .from("patient-exams")
        .upload(objectPath, buffer, { contentType: mime, upsert: false });

      if (upErr) {
        return NextResponse.json(
          {
            success: false,
            error: `Falha ao guardar exame: ${upErr.message}`,
          },
          { status: 500 }
        );
      }

      const { data: pub } = supabaseAdmin.storage
        .from("patient-exams")
        .getPublicUrl(objectPath);

      const exam = await prisma.patientExam.create({
        data: {
          patientId: body.patientId,
          title: `Evolução Visual — ${safeName}`,
          fileUrl: pub.publicUrl,
          fileType: mime,
        },
      });
      patientExamId = exam.id;

      userPrompt += `Tipo de input: IMAGEM OU PDF DE EXAME / QUESTIONÁRIO\nExtraia o array JSON conforme a skill.`;

      multimodalParts.push({ text: userPrompt });
      multimodalParts.push({
        inlineData: {
          mimeType: mime,
          data: body.data.replace(/\s/g, ""),
        },
      });
    }

    const result = await model.generateContent(multimodalParts);
    const responseText = result.response.text();
    let metricsParsed: MetricRow[];
    try {
      metricsParsed = parseMetricsJson(responseText);
    } catch {
      console.error("[metrics/generate] JSON inválido:", responseText.slice(0, 500));
      return NextResponse.json(
        {
          success: false,
          error: "A IA não devolveu JSON válido. Tente novamente ou simplifique o input.",
        },
        { status: 502 }
      );
    }

    if (metricsParsed.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Nenhuma métrica extraída. Inclua mais dados clínicos quantificáveis.",
        },
        { status: 422 }
      );
    }

    const created = await prisma.$transaction(
      metricsParsed.map((m) =>
        prisma.patientMetric.create({
          data: {
            patientId: body.patientId,
            name: m.name,
            value: m.value,
            date: new Date(m.date),
            isAutoGenerated: true,
            unit: m.unit,
            reasoning: m.reasoning,
            patientExamId,
          },
        })
      )
    );

    if (patientExamId && metricsParsed.length > 0) {
      const summarySnippet = metricsParsed
        .map((m) => `${m.name}: ${m.value} (${m.unit}) — ${m.reasoning.slice(0, 200)}`)
        .join("\n")
        .slice(0, 12000);
      await prisma.patientExam.update({
        where: { id: patientExamId },
        data: { aiSummary: summarySnippet },
      });
    }

    return NextResponse.json({
      success: true,
      metrics: created,
      patientExamId,
      model: GEMINI_MODEL,
    });
  } catch (error) {
    console.error("[POST /api/metrics/generate]", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro ao gerar métricas com a IA.",
      },
      { status: 500 }
    );
  }
}
