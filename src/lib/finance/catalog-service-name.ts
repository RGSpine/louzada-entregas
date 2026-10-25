import { sanitizeText } from "@/lib/sanitize";

export const CATALOG_SERVICE_NAME_MAX = 200;
export const CATALOG_SERVICE_DESCRIPTION_MAX = 4000;

/**
 * Garante nome ≤200 caracteres (limite Zod/UX). Texto extra vai para a descrição.
 */
export function normalizeCatalogServiceFields(
  rawName: string,
  existingDescription?: string | null,
): { name: string; description: string | null } {
  const cleaned = sanitizeText(rawName.trim());
  if (!cleaned) {
    return {
      name: "",
      description: existingDescription?.trim()
        ? sanitizeText(existingDescription).slice(0, CATALOG_SERVICE_DESCRIPTION_MAX)
        : null,
    };
  }

  const priorDesc = existingDescription?.trim()
    ? sanitizeText(existingDescription).slice(0, CATALOG_SERVICE_DESCRIPTION_MAX)
    : null;

  if (cleaned.length <= CATALOG_SERVICE_NAME_MAX) {
    return { name: cleaned, description: priorDesc };
  }

  const separators = [/\s+[-–—]\s+/, /\s+\|\s+/, /\n+/, /:\s+/];
  for (const sep of separators) {
    const match = sep.exec(cleaned);
    if (!match || match.index <= 0 || match.index > CATALOG_SERVICE_NAME_MAX) continue;
    const name = cleaned.slice(0, match.index).trim();
    const rest = cleaned.slice(match.index + match[0].length).trim();
    const description = [rest, priorDesc].filter(Boolean).join("\n\n").trim();
    return {
      name: sanitizeText(name).slice(0, CATALOG_SERVICE_NAME_MAX),
      description: description
        ? sanitizeText(description).slice(0, CATALOG_SERVICE_DESCRIPTION_MAX)
        : null,
    };
  }

  const name = cleaned.slice(0, CATALOG_SERVICE_NAME_MAX).trim();
  const overflow = cleaned.slice(CATALOG_SERVICE_NAME_MAX).trim();
  const description = [overflow, priorDesc].filter(Boolean).join("\n\n").trim();
  return {
    name: sanitizeText(name),
    description: description
      ? sanitizeText(description).slice(0, CATALOG_SERVICE_DESCRIPTION_MAX)
      : null,
  };
}
