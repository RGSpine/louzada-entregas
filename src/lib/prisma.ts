import { PrismaClient } from "@prisma/client";
import {
  resolvePrismaDatabaseUrl,
  resolvePrismaDirectUrl,
} from "@/lib/prisma-db-url";
import { runShowcaseAgendaRefresh } from "@/lib/showcase-agenda-refresh-hook";

// Singleton pattern para prevenir múltiplas instâncias do PrismaClient
// Compatível com Next.js 16 e Turbopack
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaUrl: string | undefined;
};

const databaseUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_URL;

if (databaseUrl) {
  if (databaseUrl.includes(":6543") && !databaseUrl.includes("pgbouncer=true")) {
    console.warn(
      "⚠️ ATENÇÃO: DATABASE_URL usa Transaction Pooler (6543) sem pgbouncer=true — será aplicado automaticamente pelo Prisma client.",
    );
  }
  if (!databaseUrl.includes("connection_limit=")) {
    console.info(
      "[prisma] connection_limit aplicado automaticamente (1 em produção, 5 no servidor local).",
    );
  }
}

if (!directUrl && process.env.NODE_ENV === "development") {
  console.warn(
    "⚠️ ATENÇÃO: DIRECT_URL não está configurada.\n" +
      "O Prisma CLI (migrate, db push) precisa de DIRECT_URL (Session pooler :5432 ou db.[ref].supabase.co).\n" +
      "Rode: npm run db:patch-env",
  );
}

function agendaUserIdFromWrite(
  operation: string,
  args: unknown,
  result: unknown,
): string | null {
  const input = args as {
    data?: { professionalUserId?: unknown } | Array<{ professionalUserId?: unknown }>;
    where?: { professionalUserId?: unknown };
  };
  if (operation === "create" || operation === "upsert") {
    const data = input.data;
    if (data && !Array.isArray(data) && typeof data.professionalUserId === "string") {
      return data.professionalUserId;
    }
  }
  if (operation === "createMany" && Array.isArray(input.data)) {
    const ids = input.data
      .map((row) => row.professionalUserId)
      .filter((id): id is string => typeof id === "string");
    return ids[0] ?? null;
  }
  if (
    (operation === "updateMany" || operation === "deleteMany") &&
    typeof input.where?.professionalUserId === "string"
  ) {
    return input.where.professionalUserId;
  }
  if (
    (operation === "update" || operation === "delete") &&
    result &&
    typeof result === "object" &&
    "professionalUserId" in result &&
    typeof result.professionalUserId === "string"
  ) {
    return result.professionalUserId;
  }
  return null;
}

// next dev fica aberto o tempo todo. O pooler de transação (6543) fila cada leitura.
// No computador local a sessão (5432) reaproveita a conexão. A Vercel continua no 6543.
const resolvedDatabaseUrl = databaseUrl
  ? process.env.NODE_ENV !== "production" && directUrl
    ? resolvePrismaDirectUrl(directUrl)
    : resolvePrismaDatabaseUrl(databaseUrl)
  : undefined;
if (globalForPrisma.prisma && globalForPrisma.prismaUrl !== resolvedDatabaseUrl) {
  void globalForPrisma.prisma.$disconnect().catch(() => undefined);
  globalForPrisma.prisma = undefined;
}

const prismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(resolvedDatabaseUrl
      ? { datasources: { db: { url: resolvedDatabaseUrl } } }
      : {}),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  }).$extends({
    query: {
      appointment: {
        async $allOperations({ operation, args, query }) {
          const result = await query(args);
          const userId = agendaUserIdFromWrite(operation, args, result);
          if (userId) runShowcaseAgendaRefresh(userId);
          return result;
        },
      },
    },
  });

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = prismaClient as unknown as PrismaClient;
  globalForPrisma.prismaUrl = resolvedDatabaseUrl;
}

export const prisma = prismaClient as unknown as PrismaClient;

export { resolvePrismaDatabaseUrl, resolvePrismaDirectUrl } from "@/lib/prisma-db-url";
