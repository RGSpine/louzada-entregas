import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiV1Ok } from "@/lib/api-v1/response";

function configWarnings(): string[] {
  const w: string[] = [];
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    w.push("Supabase ausente — auth e storage falham.");
  }
  return w;
}

/** Health check público para clientes mobile/desktop (sem dados clínicos). */
export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "DB_NOT_CONFIGURED", message: "DATABASE_URL ausente." },
        meta: { apiVersion: "1.0.0" },
      },
      { status: 503 },
    );
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    const warnings = configWarnings();
    return apiV1Ok({
      status: warnings.length ? "ok_with_warnings" : "ok",
      database: "connected",
      warnings: warnings.length ? warnings : undefined,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "DB_UNAVAILABLE", message: "Base de dados indisponível." },
        meta: { apiVersion: "1.0.0" },
      },
      { status: 503 },
    );
  }
}
