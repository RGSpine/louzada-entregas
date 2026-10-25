/**
 * Expande menções temporais em português para datas yyyy-mm-dd
 * (listas de dias + mês, "08 de julho", "21/07", etc.).
 */

const MONTH_ALIASES: Record<string, number> = {
  janeiro: 1,
  jan: 1,
  fevereiro: 2,
  fev: 2,
  marco: 3,
  mar: 3,
  abril: 4,
  abr: 4,
  maio: 5,
  mai: 5,
  junho: 6,
  jun: 6,
  julho: 7,
  jul: 7,
  agosto: 8,
  ago: 8,
  setembro: 9,
  set: 9,
  outubro: 10,
  out: 10,
  novembro: 11,
  nov: 11,
  dezembro: 12,
  dez: 12,
};

const MONTH_NAME_ALT =
  "janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez";

function normalizePt(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function resolveYear(month: number, day: number, explicitYear?: number | null): number {
  if (explicitYear && explicitYear >= 2000 && explicitYear <= 2100) return explicitYear;
  const now = new Date();
  let year = now.getFullYear();
  const candidate = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (candidate.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
    year -= 1;
  }
  return year;
}

function toYmd(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(year, month - 1, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDayTokens(chunk: string): number[] {
  const days: number[] = [];
  const re = /\b(\d{1,2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(chunk)) !== null) {
    const d = Number(m[1]);
    if (d >= 1 && d <= 31) days.push(d);
  }
  return days;
}

function findMonthNumber(text: string): number | null {
  for (const [name, num] of Object.entries(MONTH_ALIASES)) {
    const re = new RegExp(`(?:^|[^a-z])${name}(?:$|[^a-z])`, "i");
    if (re.test(text)) return num;
  }
  return null;
}

function findExplicitYear(text: string): number | null {
  const m = /\b(20\d{2})\b/.exec(text);
  return m ? Number(m[1]) : null;
}

/**
 * Extrai datas de frases como:
 * - "marcar como realizadas 08 de julho, 16 de julho"
 * - "nos dias 07, 09, 14, 16, 21, 23, 28 e 30 de julho"
 * - "07/07, 09/07 e 14/07/2026"
 * - "dia 21/07"
 */
export function expandPortugueseSessionDateMentions(
  text: string | null | undefined,
): string[] {
  if (!text?.trim()) return [];
  const raw = text.trim();
  const norm = normalizePt(raw);
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (ymd: string | null) => {
    if (!ymd || seen.has(ymd)) return;
    seen.add(ymd);
    out.push(ymd);
  };

  // 1) Datas explícitas dd/mm(/aaaa)
  const slashRe = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
  let slash: RegExpExecArray | null;
  while ((slash = slashRe.exec(raw)) !== null) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    let year: number;
    if (slash[3]) {
      year = slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3]);
    } else {
      year = resolveYear(month, day);
    }
    push(toYmd(year, month, day));
  }

  // 2) "08 de julho" / "8 de julho de 2026" (repetido)
  const namedDayRe = new RegExp(
    `\\b(\\d{1,2})\\s+de\\s+(${MONTH_NAME_ALT})(?:\\s+de\\s+(20\\d{2}))?\\b`,
    "gi",
  );
  let named: RegExpExecArray | null;
  while ((named = namedDayRe.exec(norm)) !== null) {
    const day = Number(named[1]);
    const month = MONTH_ALIASES[named[2]!] ?? null;
    if (!month) continue;
    const year = named[3] ? Number(named[3]) : resolveYear(month, day);
    push(toYmd(year, month, day));
  }

  // 3) Lista de dias + um mês: "dias 07, 09, 14 e 30 de julho [de 2026]"
  const listRe = new RegExp(
    `(?:dias?|nos?\\s+dias?|em)\\s+([\\d\\s,;./eE]+?)\\s+de\\s+(${MONTH_NAME_ALT})(?:\\s+de\\s+(20\\d{2}))?`,
    "gi",
  );
  let list: RegExpExecArray | null;
  while ((list = listRe.exec(norm)) !== null) {
    const month = MONTH_ALIASES[list[2]!] ?? null;
    if (!month) continue;
    const yearHint = list[3] ? Number(list[3]) : findExplicitYear(norm);
    for (const day of parseDayTokens(list[1]!)) {
      push(toYmd(yearHint ?? resolveYear(month, day), month, day));
    }
  }

  // 3b) Lista sem a palavra "dia(s)": "07, 09, 14, 16 e 30 de julho"
  const bareListRe = new RegExp(
    `\\b(\\d{1,2}(?:\\s*[,;]\\s*\\d{1,2}|\\s+e\\s+\\d{1,2})+)\\s+de\\s+(${MONTH_NAME_ALT})(?:\\s+de\\s+(20\\d{2}))?`,
    "gi",
  );
  let bareList: RegExpExecArray | null;
  while ((bareList = bareListRe.exec(norm)) !== null) {
    const month = MONTH_ALIASES[bareList[2]!] ?? null;
    if (!month) continue;
    const yearHint = bareList[3] ? Number(bareList[3]) : findExplicitYear(norm);
    for (const day of parseDayTokens(bareList[1]!)) {
      push(toYmd(yearHint ?? resolveYear(month, day), month, day));
    }
  }

  // 4) Fallback: mês no texto + sequência de números após verbo de realização
  if (out.length === 0) {
    const month = findMonthNumber(norm);
    if (month) {
      const yearHint = findExplicitYear(norm);
      const afterDia =
        /(?:dias?|realiz|marc|fez|feita|feitas|sess)[\s\S]{0,120}?([\d\s,;e]+)/i.exec(norm);
      const days = parseDayTokens(afterDia?.[1] ?? "").filter((d) => d <= 31);
      if (days.length >= 2) {
        for (const day of days) {
          push(toYmd(yearHint ?? resolveYear(month, day), month, day));
        }
      }
    }
  }

  out.sort((a, b) => a.localeCompare(b));
  return out.slice(0, 200);
}

/**
 * Une datas do modelo com expansão do texto/narrativa (sem duplicar).
 * Aceita dias nus ("07","09") quando a narrativa traz o mês.
 */
export function mergePerformedSessionDateGuesses(params: {
  modelDates: string[] | null | undefined;
  narrativeText?: string | null;
  coerceDate: (raw: string | null | undefined) => string | null;
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (ymd: string | null) => {
    if (!ymd || seen.has(ymd)) return;
    seen.add(ymd);
    out.push(ymd);
  };

  const bareDays: number[] = [];
  for (const raw of params.modelDates ?? []) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const coerced = params.coerceDate(raw);
    if (coerced) {
      push(coerced);
      continue;
    }
    const expandedOne = expandPortugueseSessionDateMentions(raw);
    if (expandedOne.length > 0) {
      for (const ymd of expandedOne) push(ymd);
      continue;
    }
    if (/^\d{1,2}$/.test(raw.trim())) {
      const d = Number(raw.trim());
      if (d >= 1 && d <= 31) bareDays.push(d);
    }
  }

  const narrative = params.narrativeText ?? "";
  for (const ymd of expandPortugueseSessionDateMentions(narrative)) {
    push(ymd);
  }

  if (bareDays.length > 0) {
    const ctx = normalizePt(
      [narrative, ...(params.modelDates ?? [])].filter(Boolean).join(" "),
    );
    const month = findMonthNumber(ctx);
    if (month) {
      const yearHint = findExplicitYear(ctx);
      for (const day of bareDays) {
        push(toYmd(yearHint ?? resolveYear(month, day), month, day));
      }
    }
  }

  out.sort((a, b) => a.localeCompare(b));
  return out.slice(0, 200);
}

/** Heurística de intenção: criar venda vs. baixar sessões de plano existente. */
export function inferPatientSaleAction(params: {
  saleActionGuess?: string | null;
  packageSessionsGuess?: number | null;
  agreedAmountReais?: number | null;
  purchaseTypeGuess?: string | null;
  registerSalePaymentGuess?: boolean | null;
  performedDatesCount: number;
  narrativeText?: string | null;
}): "new_sale" | "mark_sessions_done" {
  const raw = (params.saleActionGuess ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_");

  if (
    raw === "mark_sessions_done" ||
    raw === "update_sessions" ||
    raw === "atualizar_sessoes" ||
    raw === "marcar_realizadas" ||
    raw === "baixa_sessoes"
  ) {
    return "mark_sessions_done";
  }
  if (raw === "new_sale" || raw === "create_purchase" || raw === "nova_venda" || raw === "criar_plano") {
    return "new_sale";
  }

  const narrative = normalizePt(params.narrativeText ?? "");
  const updateHint =
    /marcar como realiz|atualizar (as )?sess|sess(?:oes|ões) do plano|ja tinha (o )?plano|plano ja exist|baixa (nas |das )?sess|realizou as sess|realizaram as sess|feitas? as sess do/.test(
      narrative,
    );

  if (updateHint && params.performedDatesCount > 0) {
    return "mark_sessions_done";
  }

  const creatingSignals =
    (params.packageSessionsGuess != null && params.packageSessionsGuess >= 2) ||
    (params.agreedAmountReais != null && params.agreedAmountReais > 0) ||
    params.purchaseTypeGuess === "SINGLE" ||
    params.purchaseTypeGuess === "PACKAGE" ||
    params.registerSalePaymentGuess === true;

  if (params.performedDatesCount > 0 && !creatingSignals) {
    return "mark_sessions_done";
  }

  return "new_sale";
}
