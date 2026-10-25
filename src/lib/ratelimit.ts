/**
 * API pública de rate limit na borda (Edge).
 * Implementação em `edge-ratelimit.ts`; Redis em `redis.ts` (KV_REST_API_*).
 */
export {
  enforceEdgeRateLimit,
  getClientIp,
  extractSupabaseUserIdFromCookies,
} from "@/lib/edge-ratelimit";
