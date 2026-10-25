import { levenshteinDistance, normalizePatientName } from "@/lib/similar-patient-match";

/** Tratamento ou função ditos antes do nome. Não fazem parte do cadastro. */
export const PERSON_TITLE_PATTERN =
  "dr\\.?\\s*|dra\\.?\\s*|(?:doutor|doutora|dentista|profissional|professor|professora)\\s+";

const TITLE_TOKENS = new Set([
  "dr",
  "dra",
  "doutor",
  "doutora",
  "dentista",
  "profissional",
  "professor",
  "professora",
]);

const NAME_STOPWORDS = new Set(["da", "de", "do", "das", "dos"]);

/** Nome ouvido sem prefixo e sem "da/de/do". */
export function personTokens(value: string): string[] {
  return normalizePatientName(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !TITLE_TOKENS.has(token) && !NAME_STOPWORDS.has(token));
}

/** Igual, ou um caractere de diferença em nomes com pelo menos cinco letras (Adriana/Adrianda). */
export function tokensClose(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length < 5 || right.length < 5) return false;
  return levenshteinDistance(left, right) <= 1;
}
