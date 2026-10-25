import { Redis } from "@upstash/redis";

/**
 * Cliente Upstash Redis para Edge / Node.
 * Prioridade: Vercel KV (`KV_REST_API_*`) → Upstash clássico (`UPSTASH_REDIS_REST_*`).
 */
export function getKvRestCredentials(): { url: string; token: string } | null {
  const kvUrl = process.env.KV_REST_API_URL?.trim();
  const kvToken = process.env.KV_REST_API_TOKEN?.trim();
  if (kvUrl && kvToken) {
    return { url: kvUrl, token: kvToken };
  }

  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (upstashUrl && upstashToken) {
    return { url: upstashUrl, token: upstashToken };
  }

  return null;
}

export function hasKvRedisEnv(): boolean {
  return getKvRestCredentials() !== null;
}

let cachedRedis: Redis | null | undefined;

/** Singleton Redis (null se env ausente). Seguro para Edge Runtime. */
export function getRedis(): Redis | null {
  if (cachedRedis !== undefined) return cachedRedis;
  const creds = getKvRestCredentials();
  if (!creds) {
    cachedRedis = null;
    return null;
  }
  cachedRedis = new Redis({
    url: creds.url,
    token: creds.token,
  });
  return cachedRedis;
}
