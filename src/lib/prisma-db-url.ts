/**
 * Normalização de URLs Postgres (Supabase) para Prisma Client e CLI.
 */

export function resolvePrismaDatabaseUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const usesTransactionPooler =
      url.port === "6543" || rawUrl.includes(":6543/") || rawUrl.includes(":6543?");

    if (usesTransactionPooler && !url.searchParams.has("pgbouncer")) {
      url.searchParams.set("pgbouncer", "true");
    }
    if (!url.searchParams.has("connection_limit")) {
      // Servidor longo (next dev) atende várias leituras ao mesmo tempo.
      // Na Vercel cada função fica em 1, para não esgotar o pooler.
      const limit = process.env.NODE_ENV === "production" ? "1" : "5";
      url.searchParams.set("connection_limit", limit);
    }
    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", "30");
    }
    if (!url.searchParams.has("connect_timeout")) {
      url.searchParams.set("connect_timeout", "30");
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

/** DIRECT_URL / Session pooler (5432) — usado pelo Prisma migrate e db push. */
export function resolvePrismaDirectUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (!url.searchParams.has("connect_timeout")) {
      url.searchParams.set("connect_timeout", "60");
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}
