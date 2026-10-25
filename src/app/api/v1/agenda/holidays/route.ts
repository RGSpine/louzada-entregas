import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiV1Error, apiV1Ok, requireApiV1Auth } from "@/lib/api-v1/response";
import { listBrazilNationalHolidays } from "@/lib/brazil-national-holidays";
import { API_V1_READ_RATE_LIMIT } from "@/lib/rate-limit";

const YearSchema = z.coerce.number().int().min(2000).max(2100);

/** Feriados nacionais BR para exibição na agenda mobile. */
export async function GET(request: NextRequest) {
  const auth = await requireApiV1Auth(
    request,
    API_V1_READ_RATE_LIMIT,
    "api/v1/agenda:holidays",
  );
  if (!auth.ok) return auth.response;

  const yearRaw = request.nextUrl.searchParams.get("year");
  const parsed = YearSchema.safeParse(yearRaw ?? new Date().getFullYear());
  if (!parsed.success) {
    return apiV1Error("INVALID_QUERY", "Parâmetro year inválido.", 400);
  }

  const holidays = listBrazilNationalHolidays(parsed.data);
  return apiV1Ok({ holidays });
}
