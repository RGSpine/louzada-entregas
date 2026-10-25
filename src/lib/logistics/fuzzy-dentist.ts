import { levenshteinDistance } from "@/lib/similar-patient-match";
import { personTokens, tokensClose } from "@/lib/logistics/person-name";

export type DentistMatchCandidate = {
  id: string;
  name: string;
  clinicName: string | null;
  address: string;
  phone?: string | null;
  aliases: string[];
};

export type DentistChoice = {
  id: string;
  name: string;
  clinicName: string | null;
  address: string;
  phone: string | null;
};

export type DentistMatch = {
  dentistClientId: string | null;
  matchedName: string | null;
  address: string | null;
  rawClientName: string;
  /** Mais de um profissional com o mesmo primeiro nome. A revisão escolhe. */
  clientChoices: DentistChoice[];
};

function tokens(value: string): string[] {
  return personTokens(value);
}

function choiceOf(candidate: DentistMatchCandidate): DentistChoice {
  return {
    id: candidate.id,
    name: candidate.name,
    clinicName: candidate.clinicName,
    address: candidate.address,
    phone: candidate.phone ?? null,
  };
}

function labelTokens(candidate: DentistMatchCandidate): string[] {
  return tokens([candidate.name, candidate.clinicName ?? "", ...candidate.aliases].join(" "));
}

function sharesFirstName(queryFirst: string, candidate: DentistMatchCandidate): boolean {
  const labels = [tokens(candidate.name), ...candidate.aliases.map((alias) => tokens(alias))];
  return labels.some((parts) => tokensClose(queryFirst, parts[0] ?? ""));
}

function sharesSurname(querySurnames: string[], candidate: DentistMatchCandidate): boolean {
  const known = labelTokens(candidate).slice(1);
  return querySurnames.every((surname) => known.some((part) => tokensClose(surname, part)));
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

function linked(candidate: DentistMatchCandidate, rawClientName: string): DentistMatch {
  return {
    dentistClientId: candidate.id,
    matchedName: candidate.name,
    address: candidate.address,
    rawClientName,
    clientChoices: [],
  };
}

function ambiguous(peers: DentistMatchCandidate[], rawClientName: string): DentistMatch {
  return {
    dentistClientId: null,
    matchedName: null,
    address: null,
    rawClientName,
    clientChoices: peers
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"))
      .map(choiceOf),
  };
}

function unmatched(rawClientName: string): DentistMatch {
  return { dentistClientId: null, matchedName: null, address: null, rawClientName, clientChoices: [] };
}

/**
 * Prefixo (doutor, doutora, dentista, profissional) não entra no nome.
 * Primeiro nome único vincula. Primeiro nome repetido pede o sobrenome:
 * se o sobrenome ouvido fecha um só cadastro, vincula; se não, devolve a lista.
 */
export function matchDentistClient(
  clientName: string | null,
  candidates: DentistMatchCandidate[],
): DentistMatch {
  const rawClientName = clientName?.trim() ?? "";
  if (!rawClientName) return unmatched("");

  const query = tokens(rawClientName);
  const queryFirst = query[0] ?? "";
  const peers = queryFirst ? candidates.filter((candidate) => sharesFirstName(queryFirst, candidate)) : [];

  if (peers.length === 1) return linked(peers[0]!, rawClientName);
  if (peers.length > 1) {
    const narrowed = query.length >= 2 ? peers.filter((candidate) => sharesSurname(query.slice(1), candidate)) : [];
    if (narrowed.length === 1) return linked(narrowed[0]!, rawClientName);
    if (narrowed.length > 1) return ambiguous(narrowed, rawClientName);
    return ambiguous(peers, rawClientName);
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

  if (!clear || !best) return unmatched(rawClientName);
  return linked(best.candidate, rawClientName);
}
