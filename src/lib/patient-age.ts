/**
 * Data de nascimento e idade derivada (anos completos) para ficha e evoluções.
 * `Patient.age` fica como rótulo em cache; a fonte da verdade é `dateOfBirth`.
 */

export const DATE_OF_BIRTH_ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateOfBirthIso(raw: string | null | undefined): raw is string {
  return typeof raw === "string" && DATE_OF_BIRTH_ISO_RE.test(raw.trim());
}

/** YYYY-MM-DD → Date em meio-dia UTC (alinhado a Prisma `@db.Date`). */
export function parseDateOfBirthIso(raw: string | null | undefined): Date | null {
  const value = (raw ?? "").trim();
  if (!DATE_OF_BIRTH_ISO_RE.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0, 0));
  if (Number.isNaN(dt.getTime())) return null;
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m! - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  const today = new Date();
  if (
    y > today.getFullYear() ||
    (y === today.getFullYear() && m! - 1 > today.getMonth()) ||
    (y === today.getFullYear() && m! - 1 === today.getMonth() && d! > today.getDate())
  ) {
    return null;
  }
  return dt;
}

export function dateOfBirthToIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const iso = value.trim().slice(0, 10);
    return isDateOfBirthIso(iso) ? iso : null;
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  const y = value.getUTCFullYear();
  const m = String(value.getUTCMonth() + 1).padStart(2, "0");
  const d = String(value.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Aceita AAAA-MM-DD ou DD/MM/AAAA (data de atendimento da evolução). */
export function parseClinicalCalendarDate(raw: string | null | undefined): Date | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const br = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) {
    const day = Number(br[1]);
    const month = Number(br[2]);
    const year = Number(br[3]);
    const dt = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
    if (Number.isNaN(dt.getTime())) return null;
    if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
      return null;
    }
    return dt;
  }
  return parseDateOfBirthIso(value);
}

function utcYmd(d: Date): { y: number; m: number; day: number } {
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate() };
}

export function ageInCompletedYears(birth: Date, at: Date = new Date()): number | null {
  const b = utcYmd(birth);
  const a = { y: at.getFullYear(), m: at.getMonth(), day: at.getDate() };
  let years = a.y - b.y;
  if (a.m < b.m || (a.m === b.m && a.day < b.day)) years -= 1;
  if (years < 0 || years > 130) return null;
  return years;
}

export function formatAgeYearsLabel(years: number): string {
  return years === 1 ? "1 ano" : `${years} anos`;
}

export function resolvePatientAgeLabel(args: {
  dateOfBirth?: Date | string | null;
  fallbackAge?: string | null;
  at?: Date;
}): string | null {
  const iso =
    args.dateOfBirth instanceof Date
      ? dateOfBirthToIso(args.dateOfBirth)
      : typeof args.dateOfBirth === "string"
        ? dateOfBirthToIso(args.dateOfBirth)
        : null;
  const birth = iso ? parseDateOfBirthIso(iso) : null;
  if (birth) {
    const years = ageInCompletedYears(birth, args.at ?? new Date());
    if (years != null) return formatAgeYearsLabel(years);
  }
  const fallback = (args.fallbackAge ?? "").trim();
  return fallback.length > 0 ? fallback : null;
}

export function ageLabelFromBirthAndAttendance(
  birthIso: string | null | undefined,
  attendanceRaw: string | null | undefined,
): string | null {
  return resolvePatientAgeLabel({
    dateOfBirth: birthIso,
    at: parseClinicalCalendarDate(attendanceRaw) ?? new Date(),
  });
}

/**
 * Persistência: nascimento informado (ou existente) + idade atual (hoje).
 * `incomingBirthIso === undefined` não altera a data gravada.
 */
export function resolveBirthAndAgeForPersist(args: {
  incomingBirthIso?: string | null;
  existingBirth?: Date | null;
  incomingAge?: string | null;
  existingAge?: string | null;
}): { dateOfBirth: Date | null; age: string | null } {
  let birth: Date | null;
  if (args.incomingBirthIso === undefined) {
    birth = args.existingBirth ?? null;
  } else if (!args.incomingBirthIso.trim()) {
    birth = null;
  } else {
    birth = parseDateOfBirthIso(args.incomingBirthIso);
  }
  return {
    dateOfBirth: birth,
    age: resolvePatientAgeLabel({
      dateOfBirth: birth,
      fallbackAge: args.incomingAge || args.existingAge,
    }),
  };
}
