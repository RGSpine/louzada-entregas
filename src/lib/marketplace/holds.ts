import { Prisma } from "@prisma/client";

type RawClient = Pick<Prisma.TransactionClient, "$executeRaw">;

/**
 * Devolve ao marketplace slots cuja reserva temporária expirou.
 * Não mexe em BOOKED confirmado (`hold_expires_at` IS NULL).
 */
export async function releaseExpiredMarketplaceHolds(client: RawClient): Promise<void> {
  await client.$executeRaw`
    UPDATE "ScheduleSlot"
    SET
      status = 'AVAILABLE',
      patient_id = NULL,
      hold_expires_at = NULL,
      updated_at = CURRENT_TIMESTAMP
    WHERE status = 'BOOKED'
      AND hold_expires_at IS NOT NULL
      AND hold_expires_at < NOW()
  `;
}

export async function applyMarketplaceLockTimeouts(client: RawClient): Promise<void> {
  await client.$executeRaw`SET LOCAL lock_timeout = '3s'`;
  await client.$executeRaw`SET LOCAL statement_timeout = '8s'`;
}

export function isLockContentionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    error instanceof Prisma.PrismaClientKnownRequestError
      ? error.meta && typeof error.meta.code === "string"
        ? error.meta.code
        : error.code
      : "";
  return (
    message.includes("lock timeout") ||
    message.includes("lock_timeout") ||
    message.includes("could not obtain lock") ||
    message.includes("deadlock detected") ||
    message.includes("40P01") ||
    message.includes("55P03") ||
    code === "P2034"
  );
}
