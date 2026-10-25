import { DateTime } from "luxon";
import { AppointmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_SCHEDULE_TIMEZONE, normalizePtExpression } from "@/lib/schedule-temporal-parse";

export type AgendaReportKind =
  | "tomorrow_count"
  | "tomorrow_names"
  | "last_week_attended"
  | "last_month_attended"
  | "unknown";

export function classifyReportByKeywords(text: string): AgendaReportKind | null {
  const n = normalizePtExpression(text);
  if (!n) return null;

  const hasTomorrow = /\b(amanha|hoje)\b/.test(n);
  const hasWeek =
    /\b(semana passada|ultima semana|semana anterior)\b/.test(n);
  const hasMonth =
    /\b(mes passado|ultimo mes|ultimos 30|trinta dias)\b/.test(n);
  const wantsNames = /\b(nomes|quais|lista|listar)\b/.test(n);
  const wantsCount = /\b(quantos|quantas|numero|qtd|total)\b/.test(n);

  if (hasTomorrow && wantsNames) return "tomorrow_names";
  if (hasTomorrow && (wantsCount || !wantsNames)) return "tomorrow_count";
  if (hasWeek) return "last_week_attended";
  if (hasMonth) return "last_month_attended";
  return null;
}

function tomorrowRangeUtc(tz: string, now = new Date()) {
  const startLocal = DateTime.fromJSDate(now, { zone: "utc" })
    .setZone(tz)
    .plus({ days: 1 })
    .startOf("day");
  const endLocal = startLocal.endOf("day");
  return {
    startUtc: startLocal.toUTC().toJSDate(),
    endUtc: endLocal.toUTC().toJSDate(),
  };
}

export async function runAgendaReport(
  professionalUserId: string,
  kind: AgendaReportKind,
  tz: string = DEFAULT_SCHEDULE_TIMEZONE,
): Promise<string> {
  const now = new Date();

  if (kind === "tomorrow_count" || kind === "tomorrow_names") {
    const { startUtc, endUtc } = tomorrowRangeUtc(tz, now);
    const rows = await prisma.appointment.findMany({
      where: {
        professionalUserId,
        status: { notIn: [AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW] },
        startAt: { lt: endUtc },
        endAt: { gt: startUtc },
      },
      orderBy: { startAt: "asc" },
      select: {
        patient: { select: { name: true } },
        startAt: true,
      },
    });

    const names = [...new Set(rows.map((r) => r.patient.name))];
    const dayLabel = DateTime.fromJSDate(startUtc, { zone: "utc" })
      .setZone(tz)
      .toFormat("dd/LL");

    if (kind === "tomorrow_names") {
      if (names.length === 0) {
        return `Amanhã (${dayLabel}): nenhuma marcação agendada.`;
      }
      return `Amanhã (${dayLabel}): ${names.length} paciente(s) — ${names.join(", ")}.`;
    }

    return `Amanhã (${dayLabel}): ${names.length} paciente(s) agendado(s).`;
  }

  if (kind === "last_week_attended") {
    const endLocal = DateTime.fromJSDate(now, { zone: "utc" }).setZone(tz).endOf("day");
    const startLocal = endLocal.minus({ days: 7 }).startOf("day");
    const count = await prisma.appointment.count({
      where: {
        professionalUserId,
        status: AppointmentStatus.COMPLETED,
        startAt: {
          gte: startLocal.toUTC().toJSDate(),
          lte: endLocal.toUTC().toJSDate(),
        },
      },
    });
    return `Últimos 7 dias: ${count} consulta(s) marcada(s) como realizadas.`;
  }

  if (kind === "last_month_attended") {
    const endLocal = DateTime.fromJSDate(now, { zone: "utc" }).setZone(tz).endOf("day");
    const startLocal = endLocal.minus({ days: 30 }).startOf("day");
    const count = await prisma.appointment.count({
      where: {
        professionalUserId,
        status: AppointmentStatus.COMPLETED,
        startAt: {
          gte: startLocal.toUTC().toJSDate(),
          lte: endLocal.toUTC().toJSDate(),
        },
      },
    });
    return `Últimos 30 dias: ${count} consulta(s) marcada(s) como realizadas.`;
  }

  return "Não reconheci a pergunta. Ex.: quantos pacientes amanhã, quais os nomes, quantos atendi na última semana.";
}
