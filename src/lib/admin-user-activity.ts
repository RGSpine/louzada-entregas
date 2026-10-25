import { prisma } from "@/lib/prisma";

export type UserActivityStats = {
  totalEvolutions: number;
  lastActiveAt: Date | null;
};

/** Estatísticas de uso por usuário (evoluções totais + último acesso). */
export async function getUserActivityStatsMap(
  userIds: string[],
): Promise<Map<string, UserActivityStats>> {
  const map = new Map<string, UserActivityStats>();
  if (userIds.length === 0) return map;

  for (const id of userIds) {
    map.set(id, { totalEvolutions: 0, lastActiveAt: null });
  }

  const [accessRows, evoRows] = await Promise.all([
    prisma.userAccessSession.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds } },
      _max: { lastSeenAt: true },
    }),
    prisma.$queryRaw<Array<{ userId: string; total: number; lastAt: Date | null }>>`
      SELECT p."userId" AS "userId",
             COUNT(e.id)::int AS total,
             MAX(e."createdAt") AS "lastAt"
      FROM "Patient" p
      LEFT JOIN "Evolution" e ON e."patientId" = p.id
      WHERE p."userId" = ANY(${userIds}::text[])
      GROUP BY p."userId"
    `,
  ]);

  for (const row of evoRows) {
    const entry = map.get(row.userId) ?? { totalEvolutions: 0, lastActiveAt: null };
    entry.totalEvolutions = row.total;
    entry.lastActiveAt = row.lastAt;
    map.set(row.userId, entry);
  }

  for (const row of accessRows) {
    const lastSeen = row._max.lastSeenAt;
    if (!lastSeen) continue;
    const entry = map.get(row.userId) ?? { totalEvolutions: 0, lastActiveAt: null };
    if (!entry.lastActiveAt || lastSeen > entry.lastActiveAt) {
      entry.lastActiveAt = lastSeen;
    }
    map.set(row.userId, entry);
  }

  return map;
}
