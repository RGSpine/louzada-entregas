import { levenshteinDistance, normalizePatientName } from "@/lib/similar-patient-match";

const STOPWORDS = new Set(["da", "de", "do", "das", "dos", "dr", "dra", "doutor", "doutora"]);

export type DentistMatchCandidate = {
  id: string;
  name: string;
  clinicName: string | null;
  address: string;
  phone?: string | null;
  aliases: string[];
};

export type DentistMatch = {
  dentistClientId: string | null;
  matchedName: string | null;
  address: string | null;
  rawClientName: string;
};

function tokens(value: string): string[] {
  return normalizePatientName(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !STOPWORDS.has(token));
}

function similarity(left: string, right: string): number {
  const a = tokens(left).join(" ");
  const b = tokens(right).join(" ");
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (b.includes(a) || a.includes(b)) return 0.92;
  const distance = levenshteinDistance(a, b);
  const scale = Math.max(a.length, b.length);
  return Math.max(0, 1 - distance / scale);
}

function bestLabelScore(query: string, candidate: DentistMatchCandidate): number {
  const labels = [candidate.name, candidate.clinicName ?? "", ...candidate.aliases];
  return Math.max(...labels.map((label) => similarity(query, label)));
}

/**
 * Só vincula com correspondência clara. Sem isso, o nome ouvido fica em rawClientName.
 */
export function matchDentistClient(
  clientName: string | null,
  candidates: DentistMatchCandidate[],
): DentistMatch {
  const rawClientName = clientName?.trim() ?? "";
  if (!rawClientName) {
    return { dentistClientId: null, matchedName: null, address: null, rawClientName: "" };
  }

  const ranked = candidates
    .map((candidate) => ({ candidate, score: bestLabelScore(rawClientName, candidate) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const second = ranked[1];
  const clear =
    best != null &&
    best.score >= 0.84 &&
    (second == null || best.score - second.score >= 0.08);

  if (!clear || !best) {
    return { dentistClientId: null, matchedName: null, address: null, rawClientName };
  }

  return {
    dentistClientId: best.candidate.id,
    matchedName: best.candidate.name,
    address: best.candidate.address,
    rawClientName,
  };
}
