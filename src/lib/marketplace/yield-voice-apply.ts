import { DateTime } from "luxon";
import {
  DEFAULT_SCHEDULE_TIMEZONE,
  expandMultiDayDateExpressions,
  resolveAppointmentWindow,
} from "@/lib/schedule-temporal-parse";
import { resolveTimeOnDay } from "@/lib/schedule-time-expression";
import { timeLabelToMinutes } from "@/lib/marketplace/slot-grid";
import {
  deleteYieldOfferWindow,
  getYieldDashboard,
  offerAgendaSlotForYield,
  saveYieldConfig,
  saveYieldOfferWindow,
  withdrawMarketplaceSlot,
} from "@/app/actions/yield-config";
import {
  normalizeYieldDiscount,
  type YieldVoiceAction,
  type YieldVoiceCommand,
  type YieldVoiceModelOutput,
} from "@/lib/marketplace/yield-voice-schema";
import type { YieldConfigData, YieldDashboardData } from "@/lib/marketplace/yield-schema";

export type YieldVoiceApplyResult = {
  action: YieldVoiceAction | null;
  enabled?: boolean;
  offered: Array<{ startAt: string }>;
  withdrawn: Array<{ startAt: string }>;
  windowsSaved: number;
  windowsDeleted: number;
  errors: string[];
  summary: string | null;
  dashboard: YieldDashboardData | null;
};

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function resolveTimeMinutes(expr: string | null | undefined): number | null {
  if (!expr?.trim()) return null;
  const normalized = expr
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "")
    .replace(/horas?$/, "")
    .replace(/^as/, "");
  const hm = /^(\d{1,2}):(\d{2})$/.exec(normalized);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  const hOnly = /^(\d{1,2})h(\d{2})?$/.exec(normalized);
  if (hOnly) {
    return Number(hOnly[1]) * 60 + (hOnly[2] ? Number(hOnly[2]) : 0);
  }
  return timeLabelToMinutes(normalized.includes(":") ? normalized : `${normalized}:00`);
}

function expandOfferDates(
  item: YieldVoiceCommand,
  now: Date,
  timezone: string,
): string[] {
  const expr = item.dateExpression?.trim();
  if (!expr) return [];

  const repetitions = item.repetitions && item.repetitions > 1 ? item.repetitions : null;
  if (repetitions && item.weekdays?.length === 1) {
    const weekday = item.weekdays[0]!;
    const startLocal = DateTime.fromJSDate(now, { zone: "utc" }).setZone(timezone).startOf("day");
    let cursor = startLocal;
    // Próxima ocorrência do weekday (hoje conta se ainda há tempo — o slot resolve depois).
    while (cursor.weekday !== weekday) {
      cursor = cursor.plus({ days: 1 });
    }
    const dates: string[] = [];
    for (let i = 0; i < repetitions; i += 1) {
      dates.push(cursor.plus({ weeks: i }).toFormat("dd/LL/yyyy"));
    }
    return dates;
  }

  const multi = expandMultiDayDateExpressions(expr, now, timezone);
  if (multi.length > 0) return multi;
  return [expr];
}

async function resolveSlotUtc(
  dateExpression: string,
  timeExpression: string,
  now: Date,
  timezone: string,
): Promise<{ ok: true; startAt: Date; endAt: Date } | { ok: false; error: string }> {
  const window = resolveAppointmentWindow(dateExpression, now, timezone);
  if (!window.ok) return { ok: false, error: window.message };

  const dayLocal = DateTime.fromJSDate(window.startUtc, { zone: "utc" })
    .setZone(timezone)
    .startOf("day");
  const timeRes = resolveTimeOnDay(dayLocal, timeExpression);
  if (!timeRes.ok) return { ok: false, error: timeRes.error };

  const startAt = timeRes.at.toUTC().toJSDate();
  const endAt = timeRes.at.plus({ minutes: 60 }).toUTC().toJSDate();
  return { ok: true, startAt, endAt };
}

export async function applyYieldVoiceIntent(params: {
  model: YieldVoiceModelOutput;
  currentConfig: YieldConfigData;
  now?: Date;
  timezone?: string;
}): Promise<YieldVoiceApplyResult> {
  const now = params.now ?? new Date();
  const timezone = params.timezone ?? DEFAULT_SCHEDULE_TIMEZONE;
  const model = params.model;

  const outcome: YieldVoiceApplyResult = {
    action: model.action === "none" || model.action === "ambiguous" ? null : model.action,
    offered: [],
    withdrawn: [],
    windowsSaved: 0,
    windowsDeleted: 0,
    errors: [],
    summary: model.transcriptOrSummary ?? null,
    dashboard: null,
  };

  if (model.action === "none" || model.action === "ambiguous") {
    return outcome;
  }

  const commands =
    model.commands.length > 0
      ? model.commands
      : [{ itemAction: model.action } satisfies YieldVoiceCommand];

  let workingConfig = { ...params.currentConfig };

  for (const raw of commands) {
    const kind: YieldVoiceAction = raw.itemAction ?? model.action;

    if (kind === "enable" || kind === "disable") {
      const enabled = kind === "enable";
      const result = await saveYieldConfig({
        enabled,
        hoursBeforeTrigger: workingConfig.hoursBeforeTrigger,
        discountPercentage: workingConfig.discountPercentage,
      });
      if (!result.success) {
        outcome.errors.push(result.error);
        continue;
      }
      workingConfig = result.data;
      outcome.enabled = result.data.enabled;
      continue;
    }

    if (kind === "set_rule") {
      const discount =
        normalizeYieldDiscount(raw) ?? workingConfig.discountPercentage;
      const hours =
        raw.hoursBeforeTrigger ?? workingConfig.hoursBeforeTrigger;
      const result = await saveYieldConfig({
        enabled: workingConfig.enabled,
        hoursBeforeTrigger: hours,
        discountPercentage: discount,
      });
      if (!result.success) {
        outcome.errors.push(result.error);
        continue;
      }
      workingConfig = result.data;
      outcome.enabled = result.data.enabled;
      continue;
    }

    if (kind === "offer") {
      if (!hasText(raw.dateExpression) || !hasText(raw.timeExpression)) {
        outcome.errors.push(
          "Para ofertar, diga a data e o horário. Ex.: ofereça amanhã às 15h com 30%.",
        );
        continue;
      }
      const discount = normalizeYieldDiscount(raw) ?? undefined;
      const dates = expandOfferDates(raw, now, timezone);
      for (const dateExpression of dates) {
        const slot = await resolveSlotUtc(
          dateExpression,
          raw.timeExpression!,
          now,
          timezone,
        );
        if (!slot.ok) {
          outcome.errors.push(slot.error);
          continue;
        }
        const result = await offerAgendaSlotForYield({
          startAt: slot.startAt,
          endAt: slot.endAt,
          discountPercentage: discount,
        });
        if (!result.success) {
          outcome.errors.push(result.error);
          continue;
        }
        outcome.offered.push({ startAt: slot.startAt.toISOString() });
      }
      continue;
    }

    if (kind === "withdraw") {
      if (!hasText(raw.dateExpression) || !hasText(raw.timeExpression)) {
        outcome.errors.push(
          "Para retirar, diga a data e o horário. Ex.: retira a oferta de quinta às 16h.",
        );
        continue;
      }
      const slot = await resolveSlotUtc(
        raw.dateExpression!,
        raw.timeExpression!,
        now,
        timezone,
      );
      if (!slot.ok) {
        outcome.errors.push(slot.error);
        continue;
      }
      const dash = await getYieldDashboard();
      if (!dash.success) {
        outcome.errors.push(dash.error);
        continue;
      }
      const match = dash.data.slots.find(
        (s) =>
          s.status === "AVAILABLE" &&
          new Date(s.startAt).getTime() === slot.startAt.getTime(),
      );
      if (!match) {
        outcome.errors.push("Não há oferta nesse horário para retirar.");
        continue;
      }
      const result = await withdrawMarketplaceSlot({ slotId: match.id });
      if (!result.success) {
        outcome.errors.push(result.error);
        continue;
      }
      outcome.withdrawn.push({ startAt: slot.startAt.toISOString() });
      continue;
    }

    if (kind === "save_window") {
      const startMinute = resolveTimeMinutes(raw.startTimeExpression);
      const endMinute = resolveTimeMinutes(raw.endTimeExpression);
      if (startMinute == null || endMinute == null) {
        outcome.errors.push(
          "Para a janela, diga o horário inicial e final. Ex.: das 14h às 18h.",
        );
        continue;
      }
      const recurrence = raw.recurrence ?? (raw.specificDate ? "ONCE" : "WEEKLY");
      const weekdays =
        recurrence === "WEEKLY"
          ? raw.weekdays?.length
            ? raw.weekdays
            : [1, 2, 3, 4, 5]
          : [];
      const result = await saveYieldOfferWindow({
        label: raw.label ?? null,
        recurrence,
        weekdays,
        startMinute,
        endMinute,
        specificDate: recurrence === "ONCE" ? raw.specificDate ?? null : null,
        isActive: true,
      });
      if (!result.success) {
        outcome.errors.push(result.error);
        continue;
      }
      outcome.windowsSaved += 1;
      continue;
    }

    if (kind === "delete_window") {
      const dash = await getYieldDashboard();
      if (!dash.success) {
        outcome.errors.push(dash.error);
        continue;
      }
      const labelKey = raw.label?.trim().toLowerCase();
      const target =
        (labelKey
          ? dash.data.windows.find((w) => w.label?.toLowerCase() === labelKey)
          : null) ?? dash.data.windows[0];
      if (!target) {
        outcome.errors.push("Nenhuma janela para remover.");
        continue;
      }
      const result = await deleteYieldOfferWindow({ id: target.id });
      if (!result.success) {
        outcome.errors.push(result.error);
        continue;
      }
      outcome.windowsDeleted += 1;
    }
  }

  const dash = await getYieldDashboard();
  outcome.dashboard = dash.success ? dash.data : null;
  return outcome;
}
