import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function configWarnings(): string[] {
  const w: string[] = [];
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    w.push("Supabase (SUPABASE_URL / SUPABASE_ANON_KEY) ausente — auth e storage falham.");
  }
  if (!process.env.GEMINI_API_KEY) {
    w.push("GEMINI_API_KEY ausente — IA e Evolução Visual automática falham.");
  }
  if (!process.env.DEEPSEEK_API_KEY?.trim()) {
    w.push(
      "DEEPSEEK_API_KEY ausente — sem fallback de texto quando o Gemini estiver sobrecarregado.",
    );
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    w.push("STRIPE_SECRET_KEY ausente — checkout/porta Stripe falham.");
  }
  return w;
}

/**
 * Health check: base de dados obrigatória; avisos de config no corpo (200).
 */
export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      {
        status: "error",
        database: "not_configured",
        missingEnv: ["DATABASE_URL"],
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    const warnings = configWarnings();
    return NextResponse.json(
      {
        status: warnings.length ? "ok_with_warnings" : "ok",
        database: "connected",
        warnings: warnings.length ? warnings : undefined,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[health] Database check failed:", error);
    return NextResponse.json(
      {
        status: "error",
        database: "disconnected",
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
