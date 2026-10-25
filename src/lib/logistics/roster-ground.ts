import type { LogisticsTaskDraft } from "@/lib/logistics/intake-schema";
import { splitLogisticsClauses } from "@/lib/logistics/interpret-command";
import { personTokens, tokensClose } from "@/lib/logistics/person-name";

export type RosterEntry = {
  name: string;
  aliases?: string[];
};

type Span = { start: number; end: number };

type Hit = {
  name: string;
  role: "client" | "courier";
  start: number;
  end: number;
  ambiguous: boolean;
};

function titleName(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function labels(entry: RosterEntry): string[][] {
  return [entry.name, ...(entry.aliases ?? [])]
    .map((value) => personTokens(value))
    .filter((parts) => parts.length > 0);
}

function findSequence(heard: string[], wanted: string[]): Span | null {
  for (let start = 0; start < heard.length; start += 1) {
    if (!tokensClose(heard[start] ?? "", wanted[0] ?? "")) continue;
    let cursor = start;
    let found = true;
    for (let part = 1; part < wanted.length; part += 1) {
      const window = heard.slice(cursor + 1, cursor + 4);
      const next = window.findIndex((token) => tokensClose(token, wanted[part] ?? ""));
      if (next < 0) {
        found = false;
        break;
      }
      cursor = cursor + 1 + next;
    }
    if (found) return { start, end: cursor };
  }
  return null;
}

function hitsFor(heard: string[], roster: RosterEntry[], role: Hit["role"]): Hit[] {
  const result: Hit[] = [];
  const claimed = new Set<number>();

  for (const entry of roster) {
    for (const parts of labels(entry)) {
      if (parts.length < 2) continue;
      const span = findSequence(heard, parts);
      if (!span) continue;
      for (let index = span.start; index <= span.end; index += 1) claimed.add(index);
      result.push({ name: entry.name, role, ...span, ambiguous: false });
      break;
    }
  }

  const peersAt = new Map<number, RosterEntry[]>();
  for (let index = 0; index < heard.length; index += 1) {
    if (claimed.has(index)) continue;
    const token = heard[index] ?? "";
    if (token.length < 3) continue;
    const peers = roster.filter((entry) => labels(entry).some((parts) => tokensClose(token, parts[0] ?? "")));
    if (peers.length > 0) peersAt.set(index, peers);
  }

  for (const [index, peers] of peersAt) {
    if (peers.length === 1) {
      result.push({ name: peers[0]?.name ?? "", role, start: index, end: index, ambiguous: false });
      continue;
    }
    result.push({ name: titleName(heard[index] ?? ""), role, start: index, end: index, ambiguous: true });
  }

  return result.filter((hit) => hit.name);
}

/** O mesmo trecho não pode ser cliente e entregador. O nome mais completo fica. */
function resolveHits(hits: Hit[]): Hit[] {
  const sorted = [...hits].sort((left, right) => right.end - right.start - (left.end - left.start));
  const kept: Hit[] = [];
  for (const hit of sorted) {
    const clash = kept.find((other) => hit.start <= other.end && other.start <= hit.end);
    if (!clash) {
      kept.push(hit);
      continue;
    }
    const sameLength = clash.end - clash.start === hit.end - hit.start;
    if (sameLength && clash.role !== hit.role) {
      kept.splice(kept.indexOf(clash), 1);
    }
  }
  return kept;
}

function linkHeard(heard: string, roster: RosterEntry[]): string {
  const tokens = personTokens(heard);
  if (tokens.length === 0) return heard;
  const peers = roster.filter((entry) =>
    labels(entry).some((parts) => tokens.every((token) => parts.some((part) => tokensClose(token, part)))),
  );
  return peers.length === 1 ? (peers[0]?.name ?? heard) : heard;
}

function choose(hits: Hit[], role: Hit["role"]): string | null {
  const names = new Set(hits.filter((hit) => hit.role === role).map((hit) => hit.name));
  if (names.size !== 1) return null;
  return [...names][0] ?? null;
}

function groundClause(
  clause: string,
  task: LogisticsTaskDraft,
  clients: RosterEntry[],
  couriers: RosterEntry[],
): LogisticsTaskDraft {
  const heard = personTokens(clause);
  const hits = resolveHits([...hitsFor(heard, clients, "client"), ...hitsFor(heard, couriers, "courier")]);
  const clientName = task.clientName?.trim() ? linkHeard(task.clientName, clients) : choose(hits, "client");
  const courierName = task.courierName?.trim() ? linkHeard(task.courierName, couriers) : choose(hits, "courier");
  return { ...task, clientName, courierName };
}

/**
 * Lê as listas cadastradas e preenche o cliente ou o entregador que a frase não marcou.
 * Vale para qualquer nome do cadastro, na ordem em que foi falado.
 */
export function groundTasksOnRoster(
  transcript: string,
  tasks: LogisticsTaskDraft[],
  clients: RosterEntry[],
  couriers: RosterEntry[],
): LogisticsTaskDraft[] {
  if (tasks.length === 0 || (clients.length === 0 && couriers.length === 0)) return tasks;
  const clauses = splitLogisticsClauses(transcript);
  const sources = clauses.length === tasks.length ? clauses : tasks.length === 1 ? [transcript] : clauses;
  return tasks.map((task, index) => groundClause(sources[index] ?? transcript, task, clients, couriers));
}
