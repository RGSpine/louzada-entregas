import { DateTime } from "luxon";
import { professionOptions } from "@/lib/profession-options";

const TZ = "America/Sao_Paulo";
const MAX_TEXT = 80;

export type ShowcaseSearch = {
  profession: string | null;
  specialty: string | null;
  region: string | null;
  city: string | null;
  neighborhood: string | null;
  /** Data civil AAAA-MM-DD no fuso de Brasília. Só a conta de paciente usa. */
  day: string | null;
  /** Hora HH:mm no fuso de Brasília. Só vale junto com o dia. */
  time: string | null;
  radiusKm: 5 | 10 | 25 | 50 | null;
  latitude: number | null;
  longitude: number | null;
};

export type ShowcaseSlotWindow = {
  start: Date;
  end: Date;
  /** Instante pedido. Null quando a busca é o dia inteiro. */
  instant: Date | null;
};

function clipText(value: string | undefined): string | null {
  const trimmed = value?.trim().slice(0, MAX_TEXT) ?? "";
  if (!trimmed) return null;
  return trimmed.replace(/[\u0000-\u001f]/g, "");
}

function clipDay(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const date = DateTime.fromISO(trimmed, { zone: TZ });
  if (!date.isValid) return null;
  return date.toISODate();
}

function clipTime(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  const match = /^(\d{2}):(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${match[1]}:${match[2]}`;
}

const RADIUS_OPTIONS = [5, 10, 25, 50] as const;

function clipRadius(value: string | undefined): ShowcaseSearch["radiusKm"] {
  const parsed = Number(value);
  return RADIUS_OPTIONS.find((option) => option === parsed) ?? null;
}

function clipCoordinate(
  value: string | undefined,
  min: number,
  max: number,
): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

export function parseShowcaseSearch(raw: {
  profissao?: string;
  especialidade?: string;
  regiao?: string;
  cidade?: string;
  bairro?: string;
  dia?: string;
  horario?: string;
  raio?: string;
  lat?: string;
  lng?: string;
}): ShowcaseSearch {
  const day = clipDay(raw.dia);
  const radiusKm = clipRadius(raw.raio);
  const latitude = clipCoordinate(raw.lat, -90, 90);
  const longitude = clipCoordinate(raw.lng, -180, 180);
  const hasPoint = radiusKm != null && latitude != null && longitude != null;
  return {
    profession: clipText(raw.profissao),
    specialty: clipText(raw.especialidade),
    region: clipText(raw.regiao),
    city: clipText(raw.cidade),
    neighborhood: clipText(raw.bairro),
    day,
    time: day ? clipTime(raw.horario) : null,
    radiusKm: hasPoint ? radiusKm : null,
    latitude: hasPoint ? latitude : null,
    longitude: hasPoint ? longitude : null,
  };
}

export function showcaseSearchIsActive(search: ShowcaseSearch): boolean {
  return Boolean(
    search.profession ||
      search.specialty ||
      search.region ||
      search.city ||
      search.neighborhood ||
      search.day ||
      search.radiusKm,
  );
}

/** Distância em km entre dois pontos. Ignora altitude. */
export function distanceKm(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(to.latitude - from.latitude);
  const dLng = toRad(to.longitude - from.longitude);
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Valores de profissão que batem com o texto digitado (rótulo ou slug). */
export function professionSearchValues(query: string): string[] {
  const folded = fold(query);
  const matches = professionOptions
    .filter(
      (item) =>
        fold(item.label).includes(folded) || fold(item.value).includes(folded),
    )
    .map((item) => item.value);
  return matches.length > 0 ? matches : [query];
}

/**
 * Janela do horário pedido, em America/Sao_Paulo.
 * Dia inteiro quando não há hora. Null se a data não existe.
 */
export function showcaseSlotWindow(
  day: string,
  time: string | null,
): ShowcaseSlotWindow | null {
  const start = DateTime.fromISO(day, { zone: TZ }).startOf("day");
  if (!start.isValid) return null;
  const end = start.plus({ days: 1 });
  if (!time) {
    return { start: start.toJSDate(), end: end.toJSDate(), instant: null };
  }
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return { start: start.toJSDate(), end: end.toJSDate(), instant: null };
  const instant = start.set({
    hour: Number(match[1]),
    minute: Number(match[2]),
    second: 0,
    millisecond: 0,
  });
  if (!instant.isValid) return null;
  return {
    start: start.toJSDate(),
    end: end.toJSDate(),
    instant: instant.toJSDate(),
  };
}
