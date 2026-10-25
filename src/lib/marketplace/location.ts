import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export type GeoPoint = {
  latitude: number;
  longitude: number;
};

const NOMINATIM_MIN_INTERVAL_MS = 1_100;
let lastNominatimAt = 0;

function parseCoordinate(value: unknown): number | null {
  if (value == null || value === "") return null;
  const raw =
    typeof value === "object" && value !== null && "toNumber" in value
      ? (value as { toNumber: () => number }).toNumber()
      : value;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function waitNominatimSlot(): Promise<void> {
  const wait = NOMINATIM_MIN_INTERVAL_MS - (Date.now() - lastNominatimAt);
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  lastNominatimAt = Date.now();
}

export async function writeProfessionalLocation(
  profileId: string,
  point: GeoPoint,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "ProfessionalProfile"
    SET
      location = ST_SetSRID(ST_MakePoint(${point.longitude}, ${point.latitude}), 4326)::geography,
      latitude = ${point.latitude},
      longitude = ${point.longitude},
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${profileId}
  `;
}

export async function geocodeAddress(address: string): Promise<GeoPoint | null> {
  const query = address.trim();
  if (query.length < 5) return null;

  await waitNominatimSlot();
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "br");

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Louzada Entregas/1.0 (marketplace-yield; http://localhost:3000)",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const rows = (await response.json()) as Array<{ lat?: string; lon?: string }>;
    const first = rows[0];
    const latitude = Number(first?.lat);
    const longitude = Number(first?.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return null;
    }
    return { latitude, longitude };
  } catch (error) {
    logger.warn("Geocode Nominatim falhou", {
      feature: "marketplace-location",
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function syncProfessionalPostgisLocation(params: {
  profileId: string;
  officeAddress: string | null;
  latitude: unknown;
  longitude: unknown;
}): Promise<boolean> {
  const lat = parseCoordinate(params.latitude);
  const lng = parseCoordinate(params.longitude);
  if (lat != null && lng != null) {
    await writeProfessionalLocation(params.profileId, {
      latitude: lat,
      longitude: lng,
    });
    return true;
  }

  if (!params.officeAddress?.trim()) return false;
  const point = await geocodeAddress(params.officeAddress);
  if (!point) return false;
  await writeProfessionalLocation(params.profileId, point);
  return true;
}
