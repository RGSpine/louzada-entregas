import {
  normalizeCommandText,
  reconcileSchedulingAction,
  type SchedulingCommandKind,
} from "@/lib/scheduling-command-terms";
import {
  DEFAULT_SCHEDULE_TIMEZONE,
  expandMultiDayDateExpressions,
} from "@/lib/schedule-temporal-parse";
import type {
  SchedulingIntentItem,
  SchedulingModelOutput,
} from "@/lib/scheduling-intent-schema";

export type SchedulingPlan = {
  /** Operação dominante já reconciliada com o léxico, ou null se nada acionável. */
  action: SchedulingCommandKind | null;
  create: SchedulingIntentItem[];
  reschedule: SchedulingIntentItem[];
  cancel: SchedulingIntentItem[];
  rename: SchedulingIntentItem[];
  /** Oferta de ociosidade sem cancelar um paciente (só data+hora+desconto). */
  yield: SchedulingIntentItem[];
  /** Falta justificada (NO_SHOW) — paciente + causa ≥ 3 caracteres. */
  noShow: SchedulingIntentItem[];
  /** True quando há ao menos um item executável. */
  hasWork: boolean;
};

export type PlanSchedulingOptions = {
  now?: Date;
  timezone?: string;
};

/**
 * Um create com data composta ("terça e quinta", "próximas 8 segundas")
 * vira N itens com o mesmo paciente/hora e uma data simples cada.
 * Idempotente para expressões já simples.
 */
export function expandCreateItemsMultiDay(
  items: SchedulingIntentItem[],
  now: Date = new Date(),
  timezone: string = DEFAULT_SCHEDULE_TIMEZONE,
): SchedulingIntentItem[] {
  const out: SchedulingIntentItem[] = [];
  for (const item of items) {
    const expr = item.dateExpression?.trim();
    if (!expr) {
      out.push(item);
      continue;
    }
    const dates = expandMultiDayDateExpressions(expr, now, timezone);
    if (dates.length <= 1) {
      out.push(
        dates.length === 1 ? { ...item, dateExpression: dates[0] } : item,
      );
      continue;
    }
    for (const dateExpression of dates) {
      out.push({ ...item, dateExpression });
    }
  }
  return out;
}

/**
 * Quando a LLM emite um item por weekday ("terça" + "quinta") em vez de
 * "terça e quinta", alinha o cluster do mesmo paciente à mesma semana civil.
 */
export function alignSiblingCreateDates(
  items: SchedulingIntentItem[],
  now: Date = new Date(),
  timezone: string = DEFAULT_SCHEDULE_TIMEZONE,
): SchedulingIntentItem[] {
  if (items.length < 2) return items;

  const byPatient = new Map<string, number[]>();
  items.forEach((item, index) => {
    const key = normalizeCommandText(item.patientNameGuess);
    if (!key) return;
    const list = byPatient.get(key) ?? [];
    list.push(index);
    byPatient.set(key, list);
  });

  const out = items.map((item) => ({ ...item }));
  for (const indices of byPatient.values()) {
    if (indices.length < 2) continue;
    const exprs = indices.map((i) => out[i]!.dateExpression?.trim() ?? "");
    if (exprs.some((e) => !e)) continue;
    const aligned = expandMultiDayDateExpressions(exprs.join(" e "), now, timezone);
    if (aligned.length !== exprs.length) continue;
    indices.forEach((idx, j) => {
      out[idx] = { ...out[idx]!, dateExpression: aligned[j] };
    });
  }
  return out;
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Remarcar exige destino. Quando o modelo não preenche newDate/newTime mas
 * preenche date/time, ele descreveu o destino nos campos da marcação atual —
 * caso comum em "remarque a Ana para sexta às 16h". Reinterpreta como destino.
 */
export function normalizeRescheduleItem(item: SchedulingIntentItem): SchedulingIntentItem {
  if (hasText(item.newDateExpression) || hasText(item.newTimeExpression)) {
    return item;
  }
  if (!hasText(item.dateExpression) && !hasText(item.timeExpression)) {
    return item;
  }
  // Destino herda date/time; campos da marcação atual ficam ausentes (undefined),
  // não null — alinhado ao .optional() do schema Zod.
  return {
    ...item,
    newDateExpression: item.dateExpression,
    newTimeExpression: item.timeExpression,
    dateExpression: undefined,
    timeExpression: undefined,
  };
}

/** Criar exige nome + data + horário (o horário nunca é inventado). */
export function isExecutableCreateItem(item: SchedulingIntentItem): boolean {
  return (
    hasText(item.patientNameGuess) &&
    hasText(item.dateExpression) &&
    hasText(item.timeExpression)
  );
}

/** Remarcar exige nome + destino (nova data e/ou nova hora). */
export function isExecutableRescheduleItem(item: SchedulingIntentItem): boolean {
  return (
    hasText(item.patientNameGuess) &&
    (hasText(item.newDateExpression) || hasText(item.newTimeExpression))
  );
}

/** Desmarcar exige apenas o nome; data/hora refinam qual marcação. */
export function isExecutableCancelItem(item: SchedulingIntentItem): boolean {
  return hasText(item.patientNameGuess);
}

/**
 * Falta justificada: nome + causa (noShowReason ou notes como fallback).
 * Data/hora refinam qual marcação SCHEDULED.
 */
export function resolveNoShowReason(item: SchedulingIntentItem): string {
  return (item.noShowReason?.trim() || item.notes?.trim() || "").trim();
}

export function isExecutableNoShowItem(item: SchedulingIntentItem): boolean {
  return hasText(item.patientNameGuess) && resolveNoShowReason(item).length >= 3;
}

export function normalizeNoShowItem(item: SchedulingIntentItem): SchedulingIntentItem {
  const reason = resolveNoShowReason(item);
  if (!reason) return item;
  return { ...item, noShowReason: reason };
}

/** Yield sem paciente: data + hora + percentual de desconto. */
export function isExecutableYieldItem(item: SchedulingIntentItem): boolean {
  return (
    hasText(item.dateExpression) &&
    hasText(item.timeExpression) &&
    typeof item.discountYield === "number" &&
    item.discountYield >= 1
  );
}

/**
 * Renomear: nome atual na agenda + novo nome.
 * Aceita `newPatientNameGuess` ou, em fallback, `title` (alguns modelos colocam o novo nome aí).
 */
export function isExecutableRenameItem(item: SchedulingIntentItem): boolean {
  const next = item.newPatientNameGuess?.trim() || item.title?.trim();
  return hasText(item.patientNameGuess) && hasText(next);
}

export function normalizeRenameItem(item: SchedulingIntentItem): SchedulingIntentItem {
  const next = item.newPatientNameGuess?.trim() || item.title?.trim();
  if (!next) return item;
  return {
    ...item,
    newPatientNameGuess: next,
  };
}

/**
 * Distribui os itens extraídos entre criar/remarcar/desmarcar/renomear/falta.
 *
 * A operação de cada item vem de `itemAction` quando presente (áudio misto);
 * caso contrário herda a ação global já corrigida pelo léxico determinístico.
 */
export function planSchedulingCommands(
  model: SchedulingModelOutput,
  options?: PlanSchedulingOptions,
): SchedulingPlan {
  const action = reconcileSchedulingAction({
    modelAction: model.action,
    transcript: model.transcriptOrSummary,
  });

  const plan: SchedulingPlan = {
    action,
    create: [],
    reschedule: [],
    cancel: [],
    rename: [],
    yield: [],
    noShow: [],
    hasWork: false,
  };

  if (!action) return plan;

  const now = options?.now ?? new Date();
  const timezone = options?.timezone ?? DEFAULT_SCHEDULE_TIMEZONE;

  for (const raw of model.appointments) {
    const kind: SchedulingCommandKind = raw.itemAction ?? action;

    if (kind === "no_show") {
      const item = normalizeNoShowItem(raw);
      if (isExecutableNoShowItem(item)) plan.noShow.push(item);
      continue;
    }
    if (kind === "cancel") {
      if (isExecutableCancelItem(raw)) plan.cancel.push(raw);
      continue;
    }
    if (kind === "yield") {
      if (isExecutableCancelItem(raw)) plan.cancel.push(raw);
      else if (isExecutableYieldItem(raw)) plan.yield.push(raw);
      continue;
    }
    if (kind === "rename") {
      const item = normalizeRenameItem(raw);
      if (isExecutableRenameItem(item)) plan.rename.push(item);
      continue;
    }
    if (kind === "reschedule") {
      const item = normalizeRescheduleItem(raw);
      if (isExecutableRescheduleItem(item)) plan.reschedule.push(item);
      continue;
    }
    if (isExecutableCreateItem(raw)) plan.create.push(raw);
  }

  plan.create = alignSiblingCreateDates(
    expandCreateItemsMultiDay(plan.create, now, timezone),
    now,
    timezone,
  );

  plan.hasWork =
    plan.create.length > 0 ||
    plan.reschedule.length > 0 ||
    plan.cancel.length > 0 ||
    plan.rename.length > 0 ||
    plan.yield.length > 0 ||
    plan.noShow.length > 0;

  return plan;
}

/** Mensagem de 422 adaptada à operação que o profissional tentou. */
export function describeMissingCommandData(action: SchedulingCommandKind | null): string {
  switch (action) {
    case "reschedule":
      return "Não foi possível identificar a remarcação. Diga o paciente e o novo dia ou horário. Ex.: remarque a Karina para sexta às 16h.";
    case "cancel":
      return "Não foi possível identificar a desmarcação. Diga o nome do paciente. Ex.: desmarque a Karina de amanhã.";
    case "rename":
      return "Não foi possível identificar o novo nome. Ex.: renomeie FECHADO para Eric.";
    case "yield":
      return "Não foi possível identificar a oferta de ociosidade. Diga o horário e o desconto. Ex.: joga o horário das 15h hoje pro desconto de 30%.";
    case "no_show":
      return "Não foi possível identificar a falta. Diga o paciente e a justificativa. Ex.: a Karina não vem amanhã, imprevisto familiar.";
    default:
      return "Não foi possível identificar marcação com paciente, data e horário. Ex.: agendar Karina hoje às 16h.";
  }
}
