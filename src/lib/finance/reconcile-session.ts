import { DateTime } from "luxon";
import {
  PatientServicePurchaseType,
  PatientServiceSessionStatus,
  Prisma,
  SessionConsumptionSource,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_SCHEDULE_TIMEZONE } from "@/lib/schedule-temporal-parse";
import type { EvolutionSessionConsumptionSummary } from "@/lib/finance/evolution-session-consumption";
import { loadEvolutionSessionConsumptionSummary } from "@/lib/finance/evolution-session-consumption-load";
import { shouldBlockSameDayAutoConsume } from "@/lib/finance/evolution-consume-same-day";

function anchorCalendarDayLocal(anchorUtc: Date, timezoneIana: string): string {
  return DateTime.fromJSDate(anchorUtc, { zone: "utc" })
    .setZone(timezoneIana)
    .toFormat("yyyy-LL-dd");
}

/**
 * Reordena `sequence` do pacote: realizadas por `consumedAt` crescente,
 * depois pendentes (e demais) na ordem anterior. Assim «Sessão 1…N»
 * reflete a cronologia dos atendimentos, mesmo se datas forem lançadas fora de ordem.
 *
 * Implementação em 2 UPDATEs (não 2×N) — evita estouro do timeout de transação
 * ao baixar várias sessões ou em pacotes grandes com pooler lento.
 */
export async function reorderPurchaseSessionsChronologically(
  tx: Prisma.TransactionClient,
  purchaseId: string,
): Promise<void> {
  const sessions = await tx.patientServiceSession.findMany({
    where: { purchaseId },
    select: { id: true, status: true, sequence: true, consumedAt: true },
  });
  if (sessions.length <= 1) return;

  const consumed = sessions
    .filter((s) => s.status === PatientServiceSessionStatus.CONSUMED)
    .sort((a, b) => {
      const ta = a.consumedAt?.getTime() ?? 0;
      const tb = b.consumedAt?.getTime() ?? 0;
      if (ta !== tb) return ta - tb;
      return a.sequence - b.sequence;
    });
  const pending = sessions
    .filter((s) => s.status === PatientServiceSessionStatus.PENDING)
    .sort((a, b) => a.sequence - b.sequence);
  const other = sessions
    .filter(
      (s) =>
        s.status !== PatientServiceSessionStatus.CONSUMED &&
        s.status !== PatientServiceSessionStatus.PENDING,
    )
    .sort((a, b) => a.sequence - b.sequence);

  const ordered = [...consumed, ...pending, ...other];
  const alreadyOk = ordered.every((s, i) => s.sequence === i + 1);
  if (alreadyOk) return;

  // @@unique([purchaseId, sequence]): 2 UPDATEs SQL em vez de 2×N round-trips.
  // Crítico com connection_limit=1 / DB lenta / baixa em lote de várias datas.
  const tempBase = 100_000;
  await tx.$executeRaw`
    UPDATE "PatientServiceSession"
    SET sequence = sequence + ${tempBase}
    WHERE purchase_id = ${purchaseId}
  `;

  const valueRows = ordered.map((s, i) => Prisma.sql`(${s.id}, ${i + 1})`);
  await tx.$executeRaw`
    UPDATE "PatientServiceSession" AS s
    SET sequence = v.seq::int
    FROM (VALUES ${Prisma.join(valueRows)}) AS v(id, seq)
    WHERE s.id = v.id
  `;
}

export type ReconcileConsumptionResult =
  | { consumed: true; sessionId: string }
  | { consumed: false; reason: string };

/**
 * Debita uma sessão pendente (FIFO) quando a agenda é concluída ou há evolução.
 * Idempotente por appointment/evolution e respeita no máximo um consumo automático por paciente por dia civil (fuso informado).
 */
export async function tryConsumePendingSessionForPatient(params: {
  professionalUserId: string;
  patientId: string;
  anchorUtc: Date;
  calendarTimezone: string;
  source:
    | typeof SessionConsumptionSource.APPOINTMENT_COMPLETED
    | typeof SessionConsumptionSource.EVOLUTION_RECORDED;
  appointmentId?: string | null;
  evolutionId?: string | null;
  preferredSessionId?: string | null;
}): Promise<ReconcileConsumptionResult> {
  const {
    professionalUserId,
    patientId,
    anchorUtc,
    calendarTimezone,
    source,
    appointmentId,
    evolutionId,
    preferredSessionId,
  } = params;

  const tz = calendarTimezone.trim() || DEFAULT_SCHEDULE_TIMEZONE;
  const calendarDayLocal = anchorCalendarDayLocal(anchorUtc, tz);

  try {
    return await prisma.$transaction(async (tx) => {
      // Serializa consumos automáticos do mesmo paciente/dia. Assim duas vias
      // simultâneas (Agenda + Evolução) não debitam sessões diferentes.
      // $executeRaw: pg_advisory_xact_lock retorna void — $queryRaw falha ao deserializar.
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${professionalUserId}:${patientId}:${calendarDayLocal}`}))`,
      );

      if (appointmentId) {
        const byAppt = await tx.sessionConsumptionEvent.findUnique({
          where: { appointmentId },
          select: { id: true },
        });
        if (byAppt) {
          return { consumed: false, reason: "Marcação já vinculou consumo." };
        }
      }
      if (evolutionId) {
        const byEv = await tx.sessionConsumptionEvent.findUnique({
          where: { evolutionId },
          select: { id: true },
        });
        if (byEv) {
          return { consumed: false, reason: "Evolução já vinculou consumo." };
        }
      }

      // Mesmo dia só bloqueia o par Agenda + Evolução da mesma visita.
      // Duas evoluções no mesmo dia (dois atendimentos) baixam duas sessões.
      if (shouldBlockSameDayAutoConsume({ appointmentId })) {
        const sameDayAuto = await tx.sessionConsumptionEvent.findFirst({
          where: {
            professionalUserId,
            patientId,
            calendarDayLocal,
            source: {
              in: [
                SessionConsumptionSource.APPOINTMENT_COMPLETED,
                SessionConsumptionSource.EVOLUTION_RECORDED,
              ],
            },
          },
          select: { id: true },
        });
        if (sameDayAuto) {
          return {
            consumed: false,
            reason: "Já houve consumo automático neste paciente neste dia civil.",
          };
        }
      }

      let resolvedSessionId = preferredSessionId ?? null;
      if (!resolvedSessionId && appointmentId) {
        const appointment = await tx.appointment.findFirst({
          where: { id: appointmentId, professionalUserId, patientId },
          select: {
            patientServiceSessionId: true,
            originatedPurchase: {
              select: {
                sessions: {
                  where: { status: PatientServiceSessionStatus.PENDING },
                  orderBy: { sequence: "asc" },
                  select: { id: true },
                  take: 1,
                },
              },
            },
          },
        });
        resolvedSessionId =
          appointment?.patientServiceSessionId ??
          appointment?.originatedPurchase?.sessions[0]?.id ??
          null;
      }

      const sessionSelect = {
        id: true,
        purchaseId: true,
        purchase: { select: { professionalUserId: true, patientId: true } },
      } as const;

      const preferPackage =
        !resolvedSessionId && source === SessionConsumptionSource.EVOLUTION_RECORDED;

      let session = await tx.patientServiceSession.findFirst({
        where: {
          ...(resolvedSessionId ? { id: resolvedSessionId } : {}),
          status: PatientServiceSessionStatus.PENDING,
          purchase: {
            patientId,
            professionalUserId,
            ...(preferPackage ? { type: PatientServicePurchaseType.PACKAGE } : {}),
          },
        },
        orderBy: [{ purchase: { purchasedAt: "asc" } }, { sequence: "asc" }],
        select: sessionSelect,
      });

      if (!session && preferPackage) {
        session = await tx.patientServiceSession.findFirst({
          where: {
            status: PatientServiceSessionStatus.PENDING,
            purchase: { patientId, professionalUserId },
          },
          orderBy: [{ purchase: { purchasedAt: "asc" } }, { sequence: "asc" }],
          select: sessionSelect,
        });
      }

      if (!session) {
        return {
          consumed: false,
          reason: "Sem sessão pendente em pacotes/compras ativas para este paciente.",
        };
      }

      const nowAnchor = anchorUtc;

      const claimed = await tx.patientServiceSession.updateMany({
        where: {
          id: session.id,
          status: PatientServiceSessionStatus.PENDING,
        },
        data: {
          status: PatientServiceSessionStatus.CONSUMED,
          consumedAt: nowAnchor,
        },
      });
      if (claimed.count !== 1) {
        return { consumed: false, reason: "Sessão já foi consumida por outra operação." };
      }

      await tx.sessionConsumptionEvent.create({
        data: {
          professionalUserId: session.purchase.professionalUserId,
          patientId: session.purchase.patientId,
          sessionId: session.id,
          source,
          consumedAtAnchor: nowAnchor,
          calendarDayLocal,
          appointmentId: appointmentId ?? null,
          evolutionId: evolutionId ?? null,
        },
      });

      await reorderPurchaseSessionsChronologically(tx, session.purchaseId);

      return { consumed: true, sessionId: session.id };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { consumed: false, reason: "Consumo já registrado." };
    }
    throw e;
  }
}


/** Espera longa pelo slot do pooler (`connection_limit=1` + access-session lento). */
const POOL_MAX_WAIT_MS = 60_000;

/** Tx curta: 1 claim + 1 event (sem reorder). */
const SINGLE_SESSION_WRITE_TX_MS = 25_000;

/** Reorder final isolado. */
const REORDER_TX_MS = 45_000;

function isExpiredTxError(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    (e.code === "P2028" || e.message.includes("expired transaction"))
  );
}

/** Marca sessão realizada manualmente pelo profissional (sem vínculo de agenda/evolução). */
export async function consumeSessionManually(
  sessionId: string,
  professionalUserId: string,
  options?: {
    /**
     * Validação de acesso ao paciente — preferencialmente fora da tx curta.
     * Ainda revalida o status PENDING no claim atómico.
     */
    assertPatientAccess?: (
      patientId: string | null,
    ) => Promise<{ ok: true } | { ok: false; error: string }>;
    /** Data efetiva informada pelo profissional para uma baixa manual histórica. */
    consumedAt?: Date;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await prisma.patientServiceSession.findFirst({
    where: {
      id: sessionId,
      purchase: { professionalUserId },
    },
    select: {
      id: true,
      status: true,
      purchaseId: true,
      purchase: {
        select: {
          id: true,
          patientId: true,
          professionalUserId: true,
        },
      },
    },
  });
  if (!session?.purchase) {
    return { ok: false, error: "Sessão não encontrada." };
  }
  if (session.status !== PatientServiceSessionStatus.PENDING) {
    return { ok: false, error: "Sessão não está pendente." };
  }

  if (options?.assertPatientAccess) {
    const access = await options.assertPatientAccess(session.purchase.patientId);
    if (!access.ok) {
      return { ok: false, error: access.error };
    }
  }

  const tz = DEFAULT_SCHEDULE_TIMEZONE;
  const anchorUtc = options?.consumedAt ?? new Date();
  const purchaseId = session.purchaseId;
  const patientId = session.purchase.patientId;
  const ownerId = session.purchase.professionalUserId;

  try {
    const wrote = await prisma.$transaction(
      async (tx) => {
        const claimed = await tx.patientServiceSession.updateMany({
          where: {
            id: session.id,
            status: PatientServiceSessionStatus.PENDING,
          },
          data: {
            status: PatientServiceSessionStatus.CONSUMED,
            consumedAt: anchorUtc,
          },
        });
        if (claimed.count !== 1) {
          return { ok: false as const, error: "Sessão já foi consumida por outra operação." };
        }

        await tx.sessionConsumptionEvent.create({
          data: {
            professionalUserId: ownerId,
            patientId,
            sessionId: session.id,
            source: SessionConsumptionSource.MANUAL,
            consumedAtAnchor: anchorUtc,
            calendarDayLocal: anchorCalendarDayLocal(anchorUtc, tz),
            appointmentId: null,
            evolutionId: null,
          },
        });

        return { ok: true as const };
      },
      { maxWait: POOL_MAX_WAIT_MS, timeout: SINGLE_SESSION_WRITE_TX_MS },
    );

    if (!wrote.ok) {
      return wrote;
    }
  } catch (e) {
    if (isExpiredTxError(e)) {
      return {
        ok: false,
        error: "A operação demorou demais no banco. Tente marcar a sessão novamente.",
      };
    }
    throw e;
  }

  // Reorder fora da tx de escrita — mesmo padrão do lote por datas (evita P2028).
  try {
    await prisma.$transaction(
      async (tx) => {
        await reorderPurchaseSessionsChronologically(tx, purchaseId);
      },
      { maxWait: POOL_MAX_WAIT_MS, timeout: REORDER_TX_MS },
    );
  } catch (e) {
    // Baixa já commitada; falha de reorder não deve bloquear o utilizador.
    if (!isExpiredTxError(e)) {
      console.error("[consumeSessionManually] reorder falhou após baixa", e);
    }
  }

  return { ok: true };
}

/**
 * Baixa N sessões PENDING numa tx já aberta (criação de compra / caminho interno).
 * Usa createMany para os eventos e reordena uma vez no final.
 */
export async function consumePendingSessionsWithDatesInTx(
  tx: Prisma.TransactionClient,
  params: {
    purchaseId: string;
    professionalUserId: string;
    patientId: string;
    dates: Date[];
  },
): Promise<{ consumed: number; skipped: number }> {
  if (params.dates.length === 0) return { consumed: 0, skipped: 0 };

  const pending = await tx.patientServiceSession.findMany({
    where: {
      purchaseId: params.purchaseId,
      status: PatientServiceSessionStatus.PENDING,
    },
    orderBy: { sequence: "asc" },
    select: { id: true },
  });

  const tz = DEFAULT_SCHEDULE_TIMEZONE;
  const events: Array<{
    professionalUserId: string;
    patientId: string;
    sessionId: string;
    source: typeof SessionConsumptionSource.MANUAL;
    consumedAtAnchor: Date;
    calendarDayLocal: string;
    appointmentId: null;
    evolutionId: null;
  }> = [];
  let consumed = 0;
  let skipped = 0;

  for (let i = 0; i < params.dates.length; i++) {
    const sessionId = pending[i]?.id;
    const anchorUtc = params.dates[i]!;
    if (!sessionId) {
      skipped += params.dates.length - i;
      break;
    }

    const claimed = await tx.patientServiceSession.updateMany({
      where: {
        id: sessionId,
        status: PatientServiceSessionStatus.PENDING,
      },
      data: {
        status: PatientServiceSessionStatus.CONSUMED,
        consumedAt: anchorUtc,
      },
    });
    if (claimed.count !== 1) {
      skipped += params.dates.length - i;
      break;
    }

    events.push({
      professionalUserId: params.professionalUserId,
      patientId: params.patientId,
      sessionId,
      source: SessionConsumptionSource.MANUAL,
      consumedAtAnchor: anchorUtc,
      calendarDayLocal: anchorCalendarDayLocal(anchorUtc, tz),
      appointmentId: null,
      evolutionId: null,
    });
    consumed += 1;
  }

  if (events.length > 0) {
    await tx.sessionConsumptionEvent.createMany({ data: events });
    await reorderPurchaseSessionsChronologically(tx, params.purchaseId);
  }

  return { consumed, skipped };
}

/**
 * Baixa em lote (áudio / UI) sob `connection_limit=1` + pooler lento.
 *
 * Não segura uma tx longa com N writes: valida fora da tx, grava **1 sessão por tx
 * curta** (sem reorder), e só no fim reordena o pacote numa tx isolada.
 * Assim o access-session (~28s) não mata a operação no meio do lote.
 */
export async function consumePurchaseSessionsByDates(params: {
  purchaseId: string;
  professionalUserId: string;
  dates: Date[];
  assertPatientAccess?: (
    patientId: string | null,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}): Promise<
  | { ok: true; consumed: number; skipped: number }
  | { ok: false; error: string }
> {
  const dates = params.dates;
  if (dates.length === 0) {
    return { ok: false, error: "Informe ao menos uma data." };
  }

  const purchase = await prisma.patientServicePurchase.findFirst({
    where: {
      id: params.purchaseId,
      professionalUserId: params.professionalUserId,
    },
    select: { id: true, patientId: true },
  });
  if (!purchase) {
    return { ok: false, error: "Compra não encontrada." };
  }

  if (params.assertPatientAccess) {
    const access = await params.assertPatientAccess(purchase.patientId);
    if (!access.ok) {
      return { ok: false, error: access.error };
    }
  }

  const pending = await prisma.patientServiceSession.findMany({
    where: {
      purchaseId: purchase.id,
      status: PatientServiceSessionStatus.PENDING,
    },
    orderBy: { sequence: "asc" },
    select: { id: true },
  });

  if (pending.length === 0) {
    return {
      ok: false,
      error: "Não há sessões pendentes suficientes neste plano para as datas informadas.",
    };
  }

  const tz = DEFAULT_SCHEDULE_TIMEZONE;
  let consumed = 0;
  let skipped = 0;

  for (let i = 0; i < dates.length; i++) {
    const sessionId = pending[i]?.id;
    const anchorUtc = dates[i]!;
    if (!sessionId) {
      skipped += dates.length - i;
      break;
    }

    try {
      const wrote = await prisma.$transaction(
        async (tx) => {
          const claimed = await tx.patientServiceSession.updateMany({
            where: {
              id: sessionId,
              status: PatientServiceSessionStatus.PENDING,
            },
            data: {
              status: PatientServiceSessionStatus.CONSUMED,
              consumedAt: anchorUtc,
            },
          });
          if (claimed.count !== 1) {
            return false;
          }
          await tx.sessionConsumptionEvent.create({
            data: {
              professionalUserId: params.professionalUserId,
              patientId: purchase.patientId,
              sessionId,
              source: SessionConsumptionSource.MANUAL,
              consumedAtAnchor: anchorUtc,
              calendarDayLocal: anchorCalendarDayLocal(anchorUtc, tz),
              appointmentId: null,
              evolutionId: null,
            },
          });
          return true;
        },
        { maxWait: POOL_MAX_WAIT_MS, timeout: SINGLE_SESSION_WRITE_TX_MS },
      );

      if (!wrote) {
        skipped += dates.length - i;
        break;
      }
      consumed += 1;
    } catch (e) {
      if (isExpiredTxError(e)) {
        if (consumed > 0) {
          try {
            await prisma.$transaction(
              async (tx) => {
                await reorderPurchaseSessionsChronologically(tx, purchase.id);
              },
              { maxWait: POOL_MAX_WAIT_MS, timeout: REORDER_TX_MS },
            );
          } catch {
            /* reorder best-effort */
          }
          return {
            ok: true,
            consumed,
            skipped: dates.length - consumed,
          };
        }
        return {
          ok: false,
          error:
            "O banco está congestionado (outra operação segura a conexão). Aguarde alguns segundos e confirme de novo.",
        };
      }
      if (consumed > 0) {
        try {
          await prisma.$transaction(
            async (tx) => {
              await reorderPurchaseSessionsChronologically(tx, purchase.id);
            },
            { maxWait: POOL_MAX_WAIT_MS, timeout: REORDER_TX_MS },
          );
        } catch {
          /* ignore */
        }
        return { ok: true, consumed, skipped: dates.length - consumed };
      }
      throw e;
    }
  }

  if (consumed === 0) {
    return {
      ok: false,
      error: "Não há sessões pendentes suficientes neste plano para as datas informadas.",
    };
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        await reorderPurchaseSessionsChronologically(tx, purchase.id);
      },
      { maxWait: POOL_MAX_WAIT_MS, timeout: REORDER_TX_MS },
    );
  } catch (e) {
    if (isExpiredTxError(e)) {
      // Sessões já CONSUMED; ordem visual pode alinhar na próxima baixa.
      return { ok: true, consumed, skipped };
    }
    throw e;
  }

  return { ok: true, consumed, skipped };
}

/** Após criar evolução: tenta debitar pacote usando a data informada ao prontuário. */
export async function onEvolutionRecorded(params: {
  professionalUserId: string;
  patientId: string;
  evolutionDate: Date;
  evolutionId: string;
  appointmentId?: string | null;
}): Promise<EvolutionSessionConsumptionSummary> {
  let calendarTimezone = DEFAULT_SCHEDULE_TIMEZONE;
  let preferredSessionId: string | null = null;

  if (params.appointmentId) {
    const appt = await prisma.appointment.findFirst({
      where: {
        id: params.appointmentId,
        professionalUserId: params.professionalUserId,
      },
      select: {
        timezoneAtBooking: true,
        patientServiceSessionId: true,
      },
    });
    if (appt?.timezoneAtBooking?.trim()) {
      calendarTimezone = appt.timezoneAtBooking;
    }
    preferredSessionId = appt?.patientServiceSessionId ?? null;
  }

  const result = await tryConsumePendingSessionForPatient({
    professionalUserId: params.professionalUserId,
    patientId: params.patientId,
    anchorUtc: params.evolutionDate,
    calendarTimezone,
    source: SessionConsumptionSource.EVOLUTION_RECORDED,
    evolutionId: params.evolutionId,
    appointmentId: params.appointmentId ?? null,
    preferredSessionId,
  });

  if (!result.consumed) {
    return { consumed: false, reason: result.reason, patientId: params.patientId };
  }

  const summary = await loadEvolutionSessionConsumptionSummary(result.sessionId);
  return (
    summary ?? {
      consumed: true,
      sessionId: result.sessionId,
      patientId: params.patientId,
    }
  );
}

export type AppointmentConsumptionHint = {
  id: string;
  patientId: string;
  professionalUserId: string;
  startAt: Date;
  timezoneAtBooking: string;
  patientServiceSessionId?: string | null;
};

/** Chamado quando `Appointment.status` passa para COMPLETED (ver action de agenda). */
export async function onAppointmentMarkedCompleted(
  row: AppointmentConsumptionHint,
): Promise<ReconcileConsumptionResult> {
  return tryConsumePendingSessionForPatient({
    professionalUserId: row.professionalUserId,
    patientId: row.patientId,
    anchorUtc: row.startAt,
    calendarTimezone: row.timezoneAtBooking,
    source: SessionConsumptionSource.APPOINTMENT_COMPLETED,
    appointmentId: row.id,
    preferredSessionId: row.patientServiceSessionId ?? null,
  });
}
