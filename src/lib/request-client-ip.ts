/**
 * Extrai IP do cliente em Route Handlers / Server Actions (Node).
 * Na Vercel, preferir x-real-ip / x-vercel-forwarded-for.
 */
export function getRequestClientIp(headers: Headers): string | null {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp && realIp.length <= 64) return realIp;

  const vercelFwd = headers.get("x-vercel-forwarded-for")?.trim();
  if (vercelFwd) {
    const first = vercelFwd.split(",")[0]?.trim();
    if (first && first.length <= 64) return first;
  }

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first && first.length <= 64) return first;
  }
  return null;
}
