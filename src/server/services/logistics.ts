import "server-only";

import { LogisticsTaskStatus } from "@prisma/client";

import { interpretContactUpdates } from "@/lib/logistics/contact-update";
import { interpretDirectorySpeech } from "@/lib/logistics/directory-speech";
import {
  interpretLogisticsEdits,
  transcriptHasEditCue,
  type LogisticsEditIntent,
} from "@/lib/logistics/interpret-edit";
import { extractLogisticsTasksWithModel } from "@/lib/logistics/extract-intake";
import { matchDentistClient, type DentistMatchCandidate } from "@/lib/logistics/fuzzy-dentist";
import { interpretLogisticsTranscript, splitLogisticsClauses } from "@/lib/logistics/interpret-command";
import { parseLogisticsIntake, type LogisticsTaskDraft } from "@/lib/logistics/intake-schema";
import { matchProsthesisPrice } from "@/lib/logistics/prosthesis-price";
import { yyyyMmDdToSaoPauloNoon } from "@/lib/finance/portuguese-payment";
import { getIntraUserContext } from "@/lib/intra-user/context";
import { prisma } from "@/lib/prisma";
import catalog from "@/lib/logistics/client-catalog.json";
import { transcribeLogisticsMedia } from "@/lib/logistics/transcribe-audio";
import { DateTime } from "luxon";

export type LogisticsDraftView = LogisticsTaskDraft & {
  rawClientName: string;
  dentistClientId: string | null;
  matchedName: string | null;
  address: string | null;
  phone: string | null;
  /** null enquanto a operadora não responde se o nome novo vira cadastro. */
  createClient: boolean | null;
  createCourier: boolean | null;
  courierKnown: boolean;
  addressInput: string;
  phoneInput: string;
};

export type DayTaskView = {
  id: string;
  type: "ENTREGA" | "COLETA";
  status: LogisticsTaskStatus;
  rawClientName: string;
  matchedName: string | null;
  address: string | null;
  workDescription: string | null;
  timeWindowStart: string | null;
  timeWindowEnd: string | null;
  motoboyIntraUserId: string | null;
  motoboyName: string | null;
  createdByName: string | null;
};

async function requireTenantId(): Promise<{ userId: string; intraUserId: string | null } | null> {
  const ctx = await getIntraUserContext();
  if (!ctx) return null;
  return { userId: ctx.tenantId, intraUserId: ctx.activeIntraUser?.id ?? null };
}

async function ensureClientCatalog(userId: string) {
  const existing = await prisma.dentistClient.count({ where: { userId } });
  if (existing > 0) return;
  await prisma.dentistClient.createMany({
    data: catalog.map((row) => ({
      userId,
      name: row.name,
      address: row.address,
      phone: row.phone,
      aliases: row.aliases,
    })),
  });
}

async function dentistCandidates(userId: string): Promise<DentistMatchCandidate[]> {
  await ensureClientCatalog(userId);
  return prisma.dentistClient.findMany({
    where: { userId },
    select: { id: true, name: true, clinicName: true, address: true, phone: true, aliases: true },
    orderBy: { name: "asc" },
  });
}

type DraftInput = LogisticsTaskDraft & Partial<Pick<LogisticsDraftView, "createClient" | "createCourier" | "addressInput" | "phoneInput">>;

function knownCourier(heard: string, couriers: Array<{ name: string }>): boolean {
  const key = heard.trim().toLocaleLowerCase("pt-BR");
  if (!key) return false;
  if (couriers.some((courier) => courier.name.trim().toLocaleLowerCase("pt-BR") === key)) return true;
  const byFirstName = couriers.filter((courier) => courier.name.trim().toLocaleLowerCase("pt-BR").split(/\s+/)[0] === key);
  return byFirstName.length === 1;
}

function toDraftView(
  task: DraftInput,
  candidates: DentistMatchCandidate[],
  couriers: Array<{ name: string }>,
): LogisticsDraftView {
  const match = matchDentistClient(task.clientName, candidates);
  const rawClientName = match.rawClientName || task.clientName || "";
  const courierKnown = task.courierName ? knownCourier(task.courierName, couriers) : false;
  const registered = candidates.find((candidate) => candidate.id === match.dentistClientId);
  return {
    ...task,
    ...match,
    phone: registered?.phone ?? null,
    rawClientName,
    courierKnown,
    createClient: match.dentistClientId || !rawClientName.trim() ? false : task.createClient ?? null,
    createCourier: !task.courierName?.trim() || courierKnown ? false : task.createCourier ?? null,
    addressInput: task.addressInput ?? "",
    phoneInput: task.phoneInput ?? "",
  };
}

export async function matchDraftIdentity(input: {
  clientName: string | null;
  courierName: string | null;
  createClient: boolean | null;
  createCourier: boolean | null;
  addressInput: string;
  phoneInput: string;
}) {
  const tenant = await requireTenantId();
  if (!tenant) return { ok: false as const, error: "Sessão expirada. Entre de novo." };
  const candidates = await dentistCandidates(tenant.userId);
  const couriers = await courierNames(tenant.userId);
  const view = toDraftView(
    {
      type: "COLETA",
      clientName: input.clientName,
      courierName: input.courierName,
      workDescription: null,
      targetDate: null,
      timeWindowStart: null,
      timeWindowEnd: null,
      amountCents: null,
      paymentMethod: null,
      createClient: input.createClient,
      createCourier: input.createCourier,
      addressInput: input.addressInput,
      phoneInput: input.phoneInput,
    },
    candidates,
    couriers,
  );
  return {
    ok: true as const,
    identity: {
      clientName: view.clientName,
      rawClientName: view.rawClientName,
      dentistClientId: view.dentistClientId,
      matchedName: view.matchedName,
      address: view.address,
      phone: view.phone,
      courierKnown: view.courierKnown,
      createClient: view.createClient,
      createCourier: view.createCourier,
    },
  };
}

export async function draftsFromTranscript(transcript: string, now = new Date()): Promise<LogisticsTaskDraft[]> {
  const local = interpretLogisticsTranscript(transcript, now);
  if (local.length > 0) return local;
  return (await extractLogisticsTasksWithModel(transcript, now)) ?? [];
}

async function courierNames(userId: string) {
  return prisma.intraUser.findMany({
    where: { userId, isMotoboy: true, active: true },
    select: { name: true },
  });
}

export type SpokenClientDraft = {
  clientName: string;
  address: string | null;
  phone: string | null;
};

function personKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\b(dr|dra|doutor|doutora)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type LogisticsEditPatch = {
  type: "ENTREGA" | "COLETA" | null;
  clientName: string | null;
  courierName: string | null;
  clearCourier: boolean;
  targetDate: string | null;
  timeWindowStart: string | null;
  timeWindowEnd: string | null;
};

export type LogisticsEditProposal = {
  taskId: string;
  label: string;
  change: string;
  patch: LogisticsEditPatch;
};

function namesHit(heard: string, labels: Array<string | null | undefined>): boolean {
  const left = personKey(heard);
  if (!left) return false;
  return labels.some((label) => {
    if (!label) return false;
    const right = personKey(label);
    return right === left || right.startsWith(`${left} `) || left.startsWith(`${right} `);
  });
}

function describeEdit(intent: LogisticsEditIntent): string {
  const parts: string[] = [];
  if (intent.type) parts.push(intent.type === "ENTREGA" ? "passa a ser entrega" : "passa a ser coleta");
  if (intent.clientName) parts.push(`cliente ${intent.clientName}`);
  if (intent.clearCourier) parts.push("sem entregador");
  else if (intent.courierName) parts.push(`entregador ${intent.courierName}`);
  if (intent.targetDate) parts.push(`data ${intent.targetDate.split("-").reverse().join("/")}`);
  if (intent.timeWindowStart && intent.timeWindowEnd) parts.push(`${intent.timeWindowStart}–${intent.timeWindowEnd}`);
  else if (intent.timeWindowEnd) parts.push(`até ${intent.timeWindowEnd}`);
  else if (intent.timeWindowStart) parts.push(`a partir de ${intent.timeWindowStart}`);
  return parts.join(", ");
}

async function findTasksForEdit(userId: string, intent: LogisticsEditIntent) {
  const rows = await prisma.logisticsTask.findMany({
    where: {
      userId,
      status: { not: "CANCELADO" },
      ...(intent.matchType ? { type: intent.matchType } : {}),
      ...(intent.matchDate ? { targetDate: new Date(`${intent.matchDate}T00:00:00.000Z`) } : {}),
    },
    include: { dentistClient: { select: { name: true } }, motoboy: { select: { name: true } } },
    orderBy: [{ targetDate: "asc" }, { timeWindowEnd: "asc" }],
  });
  const named = rows.filter((row) => namesHit(intent.matchClientName, [row.rawClientName, row.dentistClient?.name]));
  const open = named.filter((row) => row.status === "PENDENTE" || row.status === "EM_ROTA");
  return (open.length > 0 ? open : named).slice(0, 8);
}

export async function resolveLogisticsEdits(transcript: string, userId: string, now = new Date()) {
  const intents = interpretLogisticsEdits(transcript, now);
  if (intents.length === 0) {
    if (transcriptHasEditCue(transcript)) {
      return {
        handled: true as const,
        ok: false as const,
        error: "Não entendi o que alterar. Diga o cliente e a mudança, por exemplo: muda a coleta do Rodrigo para amanhã às cinco da tarde.",
      };
    }
    return { handled: false as const };
  }
  const edits: LogisticsEditProposal[] = [];
  for (const intent of intents) {
    const found = await findTasksForEdit(userId, intent);
    const kind = intent.matchType === "ENTREGA" ? "entrega" : intent.matchType === "COLETA" ? "coleta" : "marcação";
    if (found.length === 0) {
      return { handled: true as const, ok: false as const, error: `Não encontrei a ${kind} de ${intent.matchClientName}.` };
    }
    for (const task of found) {
      const date = task.targetDate ? calendarDate(task.targetDate) : "sem data";
      const clock = task.timeWindowEnd ? `até ${task.timeWindowEnd}` : "sem horário";
      edits.push({
        taskId: task.id,
        label: `${task.type} · ${task.dentistClient?.name ?? task.rawClientName} · ${date.split("-").reverse().join("/")} · ${clock} · ${task.motoboy?.name ?? "sem entregador"}`,
        change: describeEdit(intent),
        patch: {
          type: intent.type,
          clientName: intent.clientName,
          courierName: intent.courierName,
          clearCourier: intent.clearCourier,
          targetDate: intent.targetDate,
          timeWindowStart: intent.timeWindowStart,
          timeWindowEnd: intent.timeWindowEnd,
        },
      });
    }
  }
  return { handled: true as const, ok: true as const, edits };
}

export async function previewLogisticsEditCommand(transcript: string, now = new Date()) {
  const tenant = await requireTenantId();
  if (!tenant) return { ok: false as const, error: "Sessão expirada. Entre de novo." };
  const edit = await resolveLogisticsEdits(transcript, tenant.userId, now);
  if (!edit.handled || !edit.ok) {
    return {
      ok: false as const,
      error: edit.handled ? edit.error : "Não entendi qual marcação alterar. Diga o cliente e a mudança.",
    };
  }
  return { ok: true as const, edits: edit.edits };
}

async function fillCatalogPrices(userId: string, transcript: string, views: LogisticsDraftView[]) {
  if (!views.some((view) => view.amountCents == null)) return;
  const services = await prisma.professionalService.findMany({
    where: { userId, active: true },
    select: { name: true, defaultPriceCents: true },
  });
  if (services.length === 0) return;
  const clauses = splitLogisticsClauses(transcript);
  views.forEach((view, index) => {
    if (view.amountCents != null) return;
    const heard = clauses.length === views.length ? clauses[index] : views.length === 1 ? transcript : view.workDescription;
    view.amountCents = matchProsthesisPrice(heard, services);
  });
}

export async function saveLogisticsDraft(transcript: string, now = new Date()) {
  const tenant = await requireTenantId();
  if (!tenant) return { ok: false as const, error: "Sessão expirada. Entre de novo." };
  const { userId, intraUserId } = tenant;
  const edit = await resolveLogisticsEdits(transcript, userId, now);
  if (edit.handled) {
    if (!edit.ok) return { ok: false as const, error: edit.error };
    return {
      ok: true as const,
      intakeId: null,
      tasks: [] as LogisticsDraftView[],
      contactNotes: [] as string[],
      pendingClients: [] as SpokenClientDraft[],
      edits: edit.edits,
    };
  }
  const updates = interpretContactUpdates(transcript);
  const tasks = await draftsFromTranscript(transcript, now);
  const candidates = await dentistCandidates(userId);
  const couriers = await courierNames(userId);
  const parsed = tasks.length > 0 ? parseLogisticsIntake({ tasks }) : null;
  if (parsed && !parsed.ok) return { ok: false as const, error: parsed.error };
  const views = parsed?.ok ? parsed.data.tasks.map((task) => toDraftView(task, candidates, couriers)) : [];
  await fillCatalogPrices(userId, transcript, views);
  const usedOnTask = new Set<string>();
  for (const view of views) {
    const update = updates.find((item) => personKey(item.clientName) === personKey(view.rawClientName));
    if (!update) continue;
    usedOnTask.add(personKey(update.clientName));
    if (!view.addressInput && update.address) view.addressInput = update.address;
    if (!view.phoneInput && update.phone) view.phoneInput = update.phone;
  }
  const contactNotes: string[] = [];
  const pendingClients: SpokenClientDraft[] = [];
  for (const update of updates) {
    if (usedOnTask.has(personKey(update.clientName))) continue;
    const match = matchDentistClient(update.clientName, candidates);
    if (!match.dentistClientId) {
      pendingClients.push(update);
      continue;
    }
    const data: { address?: string; phone?: string } = {};
    if (update.address) data.address = update.address;
    if (update.phone) data.phone = update.phone;
    await prisma.dentistClient.updateMany({ where: { id: match.dentistClientId, userId }, data });
    const parts = [update.address ? "endereço" : null, update.phone ? "telefone" : null].filter(Boolean);
    contactNotes.push(`${parts.join(" e ")} de ${match.matchedName} atualizado.`);
  }
  if (views.length === 0) {
    if (contactNotes.length === 0 && pendingClients.length === 0) {
      return { ok: false as const, error: "Não encontrei coleta, entrega ou atualização de cadastro." };
    }
    return { ok: true as const, intakeId: null, tasks: [] as LogisticsDraftView[], contactNotes, pendingClients, edits: [] as LogisticsEditProposal[] };
  }
  const intake = await prisma.logisticsIntake.create({
    data: {
      userId,
      createdByIntraUserId: intraUserId,
      transcript: transcript.trim(),
      tasksJson: views,
      status: "DRAFT",
    },
    select: { id: true },
  });
  return { ok: true as const, intakeId: intake.id, tasks: views, contactNotes, pendingClients, edits: [] as LogisticsEditProposal[] };
}

export async function registerSpokenClient(input: SpokenClientDraft) {
  const tenant = await requireTenantId();
  if (!tenant) return { ok: false as const, error: "Sessão expirada. Entre de novo." };
  const name = input.clientName.trim().slice(0, 200);
  if (!name) return { ok: false as const, error: "Falta o nome do cliente." };
  const candidates = await dentistCandidates(tenant.userId);
  const match = matchDentistClient(name, candidates);
  const address = input.address?.trim().slice(0, 2000) ?? "";
  const phone = input.phone?.trim().slice(0, 40) || null;
  if (match.dentistClientId) {
    await prisma.dentistClient.updateMany({
      where: { id: match.dentistClientId, userId: tenant.userId },
      data: { ...(address ? { address } : {}), ...(phone ? { phone } : {}) },
    });
    return { ok: true as const, dentistClientId: match.dentistClientId };
  }
  const created = await prisma.dentistClient.create({
    data: { userId: tenant.userId, name, address, phone, aliases: [name] },
    select: { id: true },
  });
  return { ok: true as const, dentistClientId: created.id };
}

export async function previewDirectorySpeech(transcript: string) {
  const tenant = await requireTenantId();
  if (!tenant) return { ok: false as const, error: "Sessão expirada. Entre de novo." };
  const heard = interpretDirectorySpeech(transcript);
  if (heard.clients.length === 0 && heard.couriers.length === 0) {
    return {
      ok: false as const,
      error: "Não entendi o cadastro. Diga, por exemplo: cadastra o cliente Marcelo, o endereço é Rua A. Ou: cadastra o entregador Roberto.",
    };
  }
  const { userId } = tenant;
  const candidates = await dentistCandidates(userId);
  const couriers = await courierNames(userId);
  const notes: string[] = [];
  const pendingClients: SpokenClientDraft[] = [];
  const pendingCouriers: string[] = [];

  for (const client of heard.clients) {
    const match = matchDentistClient(client.clientName, candidates);
    if (!match.dentistClientId) {
      pendingClients.push(client);
      continue;
    }
    const data: { address?: string; phone?: string } = {};
    if (client.address) data.address = client.address;
    if (client.phone) data.phone = client.phone;
    if (Object.keys(data).length > 0) {
      await prisma.dentistClient.updateMany({ where: { id: match.dentistClientId, userId }, data });
      const parts = [client.address ? "endereço" : null, client.phone ? "telefone" : null].filter(Boolean);
      notes.push(`${parts.join(" e ")} de ${match.matchedName} atualizado.`);
    } else {
      notes.push(`${match.matchedName} já está no cadastro de clientes.`);
    }
  }

  for (const name of heard.couriers) {
    if (knownCourier(name, couriers)) notes.push(`${name} já está no cadastro de entregadores.`);
    else pendingCouriers.push(name);
  }

  return { ok: true as const, transcript: transcript.trim(), notes, pendingClients, pendingCouriers };
}

export async function transcribeDirectoryAudio(audio: { mimeType: string; base64: string }) {
  const heard = await transcribeLogisticsMedia(audio);
  if (!heard.ok) return heard;
  const saved = await previewDirectorySpeech(heard.transcript);
  return saved.ok ? { ...saved, transcript: heard.transcript } : saved;
}

export async function transcribeLogisticsAudio(audio: { mimeType: string; base64: string }, now = new Date()) {
  const heard = await transcribeLogisticsMedia(audio);
  if (!heard.ok) return heard;
  const saved = await saveLogisticsDraft(heard.transcript, now);
  return saved.ok ? { ...saved, transcript: heard.transcript } : saved;
}

export async function confirmLogisticsIntake(intakeId: string, tasks: LogisticsDraftView[]) {
  const tenant = await requireTenantId();
  if (!tenant) return { ok: false as const, error: "Sessão expirada. Entre de novo." };
  const { userId } = tenant;
  const intake = await prisma.logisticsIntake.findFirst({
    where: { id: intakeId, userId, status: "DRAFT" },
    select: { id: true },
  });
  if (!intake) return { ok: false as const, error: "Lote não encontrado ou já confirmado." };

  const candidates = await dentistCandidates(userId);
  const couriers = await courierNames(userId);
  const ready = tasks
    .map((task) => toDraftView(task, candidates, couriers))
    .filter((task) => task.type && task.rawClientName.trim());
  if (ready.length === 0) {
    return { ok: false as const, error: "Cada ordem precisa de coleta ou entrega e do nome citado." };
  }
  const pendingClient = ready.find((task) => task.createClient == null);
  if (pendingClient) {
    return {
      ok: false as const,
      error: `Não identifiquei o cliente ${pendingClient.rawClientName}. Responda se posso cadastrá-lo.`,
    };
  }
  const pendingCourier = ready.find((task) => task.createCourier == null);
  if (pendingCourier) {
    return {
      ok: false as const,
      error: `Não identifiquei o entregador ${pendingCourier.courierName}. Responda se posso cadastrá-lo.`,
    };
  }

  const financeCount = await prisma.$transaction(async (tx) => {
    const createdByName = new Map<string, string>();
    for (const task of ready) {
      if (task.dentistClientId || !task.rawClientName.trim() || task.createClient !== true) continue;
      const heard = task.rawClientName.trim().slice(0, 200);
      const key = heard.toLocaleLowerCase("pt-BR");
      const existing = createdByName.get(key);
      if (existing) {
        task.dentistClientId = existing;
        task.matchedName = heard;
        continue;
      }
      const created = await tx.dentistClient.create({
        data: {
          userId,
          name: heard,
          address: task.addressInput.trim(),
          phone: task.phoneInput.trim().slice(0, 40) || null,
          aliases: [heard],
        },
        select: { id: true },
      });
      createdByName.set(key, created.id);
      task.dentistClientId = created.id;
      task.matchedName = heard;
    }

    for (const task of ready) {
      if (!task.dentistClientId) continue;
      const address = task.addressInput.trim();
      const phone = task.phoneInput.trim().slice(0, 40);
      if (!address && !phone) continue;
      await tx.dentistClient.updateMany({
        where: { id: task.dentistClientId, userId },
        data: {
          ...(address ? { address } : {}),
          ...(phone ? { phone } : {}),
        },
      });
    }

    const couriersByName = new Map<string, string>();
    const knownCouriers = await tx.intraUser.findMany({
      where: { userId, isMotoboy: true, active: true },
      select: { id: true, name: true },
    });
    for (const courier of knownCouriers) couriersByName.set(courier.name.trim().toLocaleLowerCase("pt-BR"), courier.id);
    const courierIdFor = (heard: string) => {
      const key = heard.trim().toLocaleLowerCase("pt-BR");
      const exact = couriersByName.get(key);
      if (exact) return exact;
      const byFirstName = [...couriersByName.entries()].filter(([name]) => name.split(/\s+/)[0] === key);
      return byFirstName.length === 1 ? byFirstName[0]?.[1] ?? null : null;
    };
    for (const task of ready) {
      const heard = task.courierName?.trim();
      if (!heard || courierIdFor(heard) || task.createCourier !== true) continue;
      const inactive = await tx.intraUser.findFirst({
        where: { userId, isMotoboy: true, active: false, name: heard.slice(0, 80) },
        select: { id: true },
      });
      if (inactive) {
        await tx.intraUser.update({ where: { id: inactive.id }, data: { active: true } });
        couriersByName.set(heard.trim().toLocaleLowerCase("pt-BR"), inactive.id);
        continue;
      }
      const created = await tx.intraUser.create({
        data: {
          userId,
          name: heard.slice(0, 80),
          role: "MEMBER",
          isOwner: false,
          isMotoboy: true,
          canManagePatientServices: false,
          active: true,
        },
        select: { id: true },
      });
      couriersByName.set(heard.trim().toLocaleLowerCase("pt-BR"), created.id);
    }

    await tx.logisticsTask.deleteMany({ where: { intakeId, userId } });
    let posted = 0;
    for (const task of ready) {
      const created = await tx.logisticsTask.create({
        data: {
          userId,
          intakeId,
          type: task.type,
          dentistClientId: task.dentistClientId,
          rawClientName: task.rawClientName,
          motoboyIntraUserId: task.courierName ? courierIdFor(task.courierName) : null,
          status: task.courierName && courierIdFor(task.courierName) ? LogisticsTaskStatus.EM_ROTA : LogisticsTaskStatus.PENDENTE,
          workDescription: task.workDescription,
          targetDate: task.targetDate ? new Date(`${task.targetDate}T00:00:00.000Z`) : null,
          timeWindowStart: task.timeWindowStart,
          timeWindowEnd: task.timeWindowEnd,
        },
        select: { id: true },
      });
      const amountCents = task.amountCents ?? 0;
      if (amountCents <= 0) continue;
      const who = task.matchedName ?? task.rawClientName;
      await tx.financialTransaction.create({
        data: {
          professionalUserId: userId,
          kind: "INCOME",
          amountCents,
          occurredAt: (task.targetDate ? yyyyMmDdToSaoPauloNoon(task.targetDate) : null) ?? new Date(),
          method: task.paymentMethod ?? "OTHER",
          description: [task.type, who, task.workDescription].filter(Boolean).join(" · ").slice(0, 500),
          category: "Prótese",
          source: "AUDIO",
          logisticsTaskId: created.id,
        },
      });
      posted += 1;
    }
    await tx.logisticsIntake.update({
      where: { id: intakeId },
      data: { status: "CONFIRMED", tasksJson: ready },
    });
    return posted;
  });
  return { ok: true as const, count: ready.length, financeCount };
}

export async function listDayTasks(date: string): Promise<DayTaskView[]> {
  const tenant = await requireTenantId();
  if (!tenant) return [];
  const { userId } = tenant;
  const rows = await prisma.logisticsTask.findMany({
    where: { userId, targetDate: new Date(`${date}T00:00:00.000Z`) },
    include: {
      dentistClient: { select: { name: true, address: true } },
      motoboy: { select: { name: true } },
      intake: { select: { createdBy: { select: { name: true } } } },
    },
    orderBy: [{ timeWindowEnd: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    status: row.status,
    rawClientName: row.rawClientName,
    matchedName: row.dentistClient?.name ?? null,
    address: row.dentistClient?.address ?? null,
    workDescription: row.workDescription,
    timeWindowStart: row.timeWindowStart,
    timeWindowEnd: row.timeWindowEnd,
    motoboyIntraUserId: row.motoboyIntraUserId,
    motoboyName: row.motoboy?.name ?? null,
    createdByName: row.intake.createdBy?.name ?? null,
  }));
}

const SAO_PAULO = "America/Sao_Paulo";

export type AgendaTaskView = {
  id: string;
  type: "ENTREGA" | "COLETA";
  status: LogisticsTaskStatus;
  name: string;
  workDescription: string | null;
  targetDate: string;
  timeWindowStart: string | null;
  timeWindowEnd: string | null;
  motoboyIntraUserId: string | null;
  motoboyName: string | null;
  createdByName: string | null;
};

function calendarDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export async function listAgendaTasks(from: string, to: string): Promise<AgendaTaskView[]> {
  const tenant = await requireTenantId();
  if (!tenant) return [];
  const { userId } = tenant;
  const rows = await prisma.logisticsTask.findMany({
    where: {
      userId,
      targetDate: {
        gte: new Date(`${from}T00:00:00.000Z`),
        lte: new Date(`${to}T00:00:00.000Z`),
      },
    },
    include: {
      dentistClient: { select: { name: true } },
      motoboy: { select: { name: true } },
      intake: { select: { createdBy: { select: { name: true } } } },
    },
    orderBy: [{ targetDate: "asc" }, { timeWindowEnd: "asc" }],
  });
  return rows.flatMap((row) => {
    if (!row.targetDate) return [];
    return [
      {
        id: row.id,
        type: row.type,
        status: row.status,
        name: row.dentistClient?.name ?? row.rawClientName,
        workDescription: row.workDescription,
        targetDate: calendarDate(row.targetDate),
        timeWindowStart: row.timeWindowStart,
        timeWindowEnd: row.timeWindowEnd,
        motoboyIntraUserId: row.motoboyIntraUserId,
        motoboyName: row.motoboy?.name ?? null,
        createdByName: row.intake.createdBy?.name ?? null,
      },
    ];
  });
}

export async function moveLogisticsTask(taskId: string, startIso: string, endIso: string) {
  const tenant = await requireTenantId();
  if (!tenant) return { ok: false as const, error: "Sessão expirada. Entre de novo." };
  const { userId } = tenant;
  const start = DateTime.fromISO(startIso, { zone: "utc" }).setZone(SAO_PAULO);
  const end = DateTime.fromISO(endIso, { zone: "utc" }).setZone(SAO_PAULO);
  if (!start.isValid || !end.isValid || end <= start) {
    return { ok: false as const, error: "Horário inválido." };
  }
  if (start.toISODate() !== end.toISODate()) {
    return { ok: false as const, error: "A ordem fica no mesmo dia." };
  }
  const updated = await prisma.logisticsTask.updateMany({
    where: { id: taskId, userId },
    data: {
      targetDate: new Date(`${start.toISODate()}T00:00:00.000Z`),
      timeWindowStart: start.toFormat("HH:mm"),
      timeWindowEnd: end.toFormat("HH:mm"),
    },
  });
  return updated.count === 1
    ? { ok: true as const }
    : { ok: false as const, error: "Tarefa não encontrada." };
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

function cleanClock(value: string | null | undefined): string | null {
  const clock = value?.trim() ?? "";
  if (!clock) return null;
  return CLOCK.test(clock) ? clock : null;
}

function statusAfterCourier(current: LogisticsTaskStatus, motoboyId: string | null, changed: boolean): LogisticsTaskStatus {
  if (!changed || current === "CONCLUIDO" || current === "CANCELADO") return current;
  return motoboyId ? "EM_ROTA" : "PENDENTE";
}

async function courierByName(userId: string, heard: string) {
  const couriers = await prisma.intraUser.findMany({
    where: { userId, isMotoboy: true, active: true },
    select: { id: true, name: true },
  });
  const key = personKey(heard);
  const exact = couriers.find((courier) => personKey(courier.name) === key);
  if (exact) return exact.id;
  const byFirstName = couriers.filter((courier) => personKey(courier.name).split(/\s+/)[0] === key);
  return byFirstName.length === 1 ? byFirstName[0]?.id ?? null : null;
}

async function createCourier(userId: string, name: string) {
  const clean = name.trim().slice(0, 80);
  const existing = await prisma.intraUser.findMany({
    where: { userId, isMotoboy: true },
    select: { id: true, name: true, active: true },
  });
  const match = existing.find((courier) => personKey(courier.name) === personKey(clean));
  if (match) {
    if (!match.active) {
      await prisma.intraUser.update({ where: { id: match.id }, data: { active: true } });
    }
    return match.id;
  }
  const created = await prisma.intraUser.create({
    data: {
      userId,
      name: clean,
      role: "MEMBER",
      isOwner: false,
      isMotoboy: true,
      canManagePatientServices: false,
      active: true,
    },
    select: { id: true },
  });
  return created.id;
}

export async function updateLogisticsTask(input: {
  taskId: string;
  type: "ENTREGA" | "COLETA";
  clientName: string;
  targetDate: string;
  timeWindowStart: string | null;
  timeWindowEnd: string | null;
  motoboyIntraUserId: string | null;
  createClient: boolean | null;
}) {
  const tenant = await requireTenantId();
  if (!tenant) return { ok: false as const, error: "Sessão expirada. Entre de novo.", askClient: false as const };
  const clientName = input.clientName.trim().slice(0, 200);
  if (!clientName) return { ok: false as const, error: "Diga o cliente da marcação.", askClient: false as const };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.targetDate)) {
    return { ok: false as const, error: "Data inválida.", askClient: false as const };
  }
  const timeWindowStart = cleanClock(input.timeWindowStart);
  const timeWindowEnd = cleanClock(input.timeWindowEnd);
  if ((input.timeWindowStart && !timeWindowStart) || (input.timeWindowEnd && !timeWindowEnd)) {
    return { ok: false as const, error: "Horário inválido.", askClient: false as const };
  }
  if (timeWindowStart && timeWindowEnd && timeWindowStart > timeWindowEnd) {
    return { ok: false as const, error: "O horário inicial precisa ser antes do limite.", askClient: false as const };
  }
  const task = await prisma.logisticsTask.findFirst({
    where: { id: input.taskId, userId: tenant.userId },
    include: { dentistClient: { select: { id: true, name: true } } },
  });
  if (!task) return { ok: false as const, error: "Marcação não encontrada.", askClient: false as const };

  let dentistClientId = task.dentistClientId;
  let rawClientName = task.rawClientName;
  const sameClient =
    namesHit(clientName, [task.rawClientName, task.dentistClient?.name]) &&
    personKey(clientName) === personKey(task.dentistClient?.name ?? task.rawClientName);
  if (!sameClient) {
    const candidates = await dentistCandidates(tenant.userId);
    const match = matchDentistClient(clientName, candidates);
    if (match.dentistClientId) {
      dentistClientId = match.dentistClientId;
      rawClientName = (match.matchedName ?? clientName).slice(0, 200);
    } else if (input.createClient === true) {
      const created = await prisma.dentistClient.create({
        data: { userId: tenant.userId, name: clientName, address: "", phone: null, aliases: [clientName] },
        select: { id: true },
      });
      dentistClientId = created.id;
      rawClientName = clientName;
    } else if (input.createClient === false) {
      dentistClientId = null;
      rawClientName = clientName;
    } else {
      return {
        ok: false as const,
        error: `Não identifiquei o cliente ${clientName}. Responda se posso cadastrá-lo.`,
        askClient: true as const,
      };
    }
  }

  let motoboyIntraUserId: string | null = null;
  if (input.motoboyIntraUserId) {
    const motoboy = await prisma.intraUser.findFirst({
      where: { id: input.motoboyIntraUserId, userId: tenant.userId, isMotoboy: true },
      select: { id: true, active: true },
    });
    if (!motoboy) return { ok: false as const, error: "Entregador não encontrado.", askClient: false as const };
    if (!motoboy.active && motoboy.id !== task.motoboyIntraUserId) {
      return { ok: false as const, error: "Esse entregador está inativo.", askClient: false as const };
    }
    motoboyIntraUserId = motoboy.id;
  }
  const updated = await prisma.logisticsTask.updateMany({
    where: { id: task.id, userId: tenant.userId },
    data: {
      type: input.type,
      dentistClientId,
      rawClientName,
      targetDate: new Date(`${input.targetDate}T00:00:00.000Z`),
      timeWindowStart,
      timeWindowEnd,
      motoboyIntraUserId,
      status: statusAfterCourier(task.status, motoboyIntraUserId, task.motoboyIntraUserId !== motoboyIntraUserId),
    },
  });
  return updated.count === 1
    ? { ok: true as const }
    : { ok: false as const, error: "Marcação não encontrada.", askClient: false as const };
}

export async function applyLogisticsEdit(input: {
  taskId: string;
  patch: LogisticsEditPatch;
  createClient: boolean | null;
  createCourier: boolean | null;
}) {
  const tenant = await requireTenantId();
  if (!tenant) return { ok: false as const, error: "Sessão expirada. Entre de novo.", askClient: false as const, askCourier: false as const };
  const task = await prisma.logisticsTask.findFirst({
    where: { id: input.taskId, userId: tenant.userId },
    include: { dentistClient: { select: { name: true } } },
  });
  if (!task) return { ok: false as const, error: "Marcação não encontrada.", askClient: false as const, askCourier: false as const };

  const patch = input.patch;
  let dentistClientId = task.dentistClientId;
  let rawClientName = task.rawClientName;
  let createClientName: string | null = null;
  if (patch.clientName) {
    const candidates = await dentistCandidates(tenant.userId);
    const match = matchDentistClient(patch.clientName, candidates);
    if (match.dentistClientId) {
      dentistClientId = match.dentistClientId;
      rawClientName = (match.matchedName ?? patch.clientName).slice(0, 200);
    } else if (input.createClient === true) {
      createClientName = patch.clientName.slice(0, 200);
      rawClientName = createClientName;
    } else if (input.createClient === false) {
      dentistClientId = null;
      rawClientName = patch.clientName.slice(0, 200);
    } else {
      return {
        ok: false as const,
        error: `Não identifiquei o cliente ${patch.clientName}. Responda se posso cadastrá-lo.`,
        askClient: true as const,
        askCourier: false as const,
      };
    }
  }

  let motoboyIntraUserId = task.motoboyIntraUserId;
  let courierChanged = false;
  let createCourierName: string | null = null;
  if (patch.clearCourier) {
    motoboyIntraUserId = null;
    courierChanged = task.motoboyIntraUserId != null;
  } else if (patch.courierName) {
    const known = await courierByName(tenant.userId, patch.courierName);
    if (known) {
      motoboyIntraUserId = known;
      courierChanged = known !== task.motoboyIntraUserId;
    } else if (input.createCourier === true) {
      createCourierName = patch.courierName;
      courierChanged = true;
    } else if (input.createCourier === false) {
      courierChanged = false;
    } else {
      return {
        ok: false as const,
        error: `Não identifiquei o entregador ${patch.courierName}. Responda se posso cadastrá-lo.`,
        askClient: false as const,
        askCourier: true as const,
      };
    }
  }
  if (createClientName) {
    const created = await prisma.dentistClient.create({
      data: { userId: tenant.userId, name: createClientName, address: "", phone: null, aliases: [createClientName] },
      select: { id: true },
    });
    dentistClientId = created.id;
  }
  if (createCourierName) motoboyIntraUserId = await createCourier(tenant.userId, createCourierName);

  const timeWindowStart = patch.timeWindowStart ?? task.timeWindowStart;
  const timeWindowEnd = patch.timeWindowEnd ?? task.timeWindowEnd;
  const targetDate = patch.targetDate ? new Date(`${patch.targetDate}T00:00:00.000Z`) : task.targetDate;
  if (timeWindowStart && timeWindowEnd && timeWindowStart > timeWindowEnd) {
    return { ok: false as const, error: "O horário inicial precisa ser antes do limite.", askClient: false as const, askCourier: false as const };
  }
  const updated = await prisma.logisticsTask.updateMany({
    where: { id: task.id, userId: tenant.userId },
    data: {
      ...(patch.type ? { type: patch.type } : {}),
      dentistClientId,
      rawClientName,
      targetDate,
      timeWindowStart: timeWindowStart && timeWindowEnd && timeWindowStart > timeWindowEnd ? null : timeWindowStart,
      timeWindowEnd,
      motoboyIntraUserId,
      status: statusAfterCourier(task.status, motoboyIntraUserId, courierChanged),
    },
  });
  return updated.count === 1
    ? { ok: true as const }
    : { ok: false as const, error: "Marcação não encontrada.", askClient: false as const, askCourier: false as const };
}

export async function transcribeLogisticsEdit(audio: { mimeType: string; base64: string }, now = new Date()) {
  const tenant = await requireTenantId();
  if (!tenant) return { ok: false as const, error: "Sessão expirada. Entre de novo." };
  const heard = await transcribeLogisticsMedia(audio);
  if (!heard.ok) return heard;
  const edit = await resolveLogisticsEdits(heard.transcript, tenant.userId, now);
  if (!edit.handled) {
    return {
      ok: false as const,
      error: "Não entendi qual marcação alterar. Diga, por exemplo: muda a coleta do Rodrigo para amanhã às cinco da tarde.",
    };
  }
  if (!edit.ok) return { ok: false as const, error: edit.error };
  return { ok: true as const, transcript: heard.transcript, edits: edit.edits };
}

export async function assignTaskMotoboy(taskId: string, motoboyIntraUserId: string | null) {
  const tenant = await requireTenantId();
  if (!tenant) return { ok: false as const, error: "Sessão expirada. Entre de novo." };
  const { userId } = tenant;
  if (motoboyIntraUserId) {
    const motoboy = await prisma.intraUser.findFirst({
      where: { id: motoboyIntraUserId, userId, isMotoboy: true, active: true },
      select: { id: true },
    });
    if (!motoboy) return { ok: false as const, error: "Entregador não encontrado ou inativo." };
  }
  const updated = await prisma.logisticsTask.updateMany({
    where: { id: taskId, userId },
    data: {
      motoboyIntraUserId,
      status: motoboyIntraUserId ? LogisticsTaskStatus.EM_ROTA : LogisticsTaskStatus.PENDENTE,
    },
  });
  return updated.count === 1
    ? { ok: true as const }
    : { ok: false as const, error: "Tarefa não encontrada." };
}

export async function completeLogisticsTask(taskId: string) {
  const tenant = await requireTenantId();
  if (!tenant) return { ok: false as const, error: "Sessão expirada. Entre de novo." };
  const { userId } = tenant;
  const updated = await prisma.logisticsTask.updateMany({
    where: {
      id: taskId,
      userId,
      status: { in: [LogisticsTaskStatus.PENDENTE, LogisticsTaskStatus.EM_ROTA] },
    },
    data: { status: LogisticsTaskStatus.CONCLUIDO, completedAt: new Date() },
  });
  return updated.count === 1
    ? { ok: true as const }
    : { ok: false as const, error: "Só uma coleta ou entrega em aberto pode ser marcada como realizada." };
}

export async function cancelLogisticsTask(taskId: string) {
  const tenant = await requireTenantId();
  if (!tenant) return { ok: false as const, error: "Sessão expirada. Entre de novo." };
  const { userId } = tenant;
  const updated = await prisma.logisticsTask.updateMany({
    where: {
      id: taskId,
      userId,
      status: { in: [LogisticsTaskStatus.PENDENTE, LogisticsTaskStatus.EM_ROTA] },
    },
    data: { status: LogisticsTaskStatus.CANCELADO },
  });
  return updated.count === 1
    ? { ok: true as const }
    : { ok: false as const, error: "Só uma coleta ou entrega em aberto pode ser cancelada." };
}

export async function reopenLogisticsTask(taskId: string) {
  const tenant = await requireTenantId();
  if (!tenant) return { ok: false as const, error: "Sessão expirada. Entre de novo." };
  const { userId } = tenant;
  const current = await prisma.logisticsTask.findFirst({
    where: {
      id: taskId,
      userId,
      status: { in: [LogisticsTaskStatus.CONCLUIDO, LogisticsTaskStatus.CANCELADO] },
    },
    select: { motoboyIntraUserId: true },
  });
  if (!current) return { ok: false as const, error: "Essa marcação já está em aberto." };
  const updated = await prisma.logisticsTask.updateMany({
    where: { id: taskId, userId },
    data: {
      status: current.motoboyIntraUserId ? LogisticsTaskStatus.EM_ROTA : LogisticsTaskStatus.PENDENTE,
      completedAt: null,
    },
  });
  return updated.count === 1
    ? { ok: true as const }
    : { ok: false as const, error: "Tarefa não encontrada." };
}

export async function listMotoboys() {
  const tenant = await requireTenantId();
  if (!tenant) return [];
  const { userId } = tenant;
  return prisma.intraUser.findMany({
    where: { userId, isMotoboy: true },
    select: { id: true, name: true, active: true },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}

export async function createMotoboy(name: string) {
  const tenant = await requireTenantId();
  if (!tenant) return { ok: false as const, error: "Sessão expirada. Entre de novo." };
  const { userId } = tenant;
  const clean = name.trim().slice(0, 80);
  if (!clean) return { ok: false as const, error: "Diga o nome do entregador." };
  const existing = await prisma.intraUser.findMany({
    where: { userId, isMotoboy: true },
    select: { id: true, name: true, active: true },
  });
  const match = existing.find((courier) => personKey(courier.name) === personKey(clean));
  if (match?.active) return { ok: false as const, error: `${match.name} já está no cadastro de entregadores.` };
  if (match) {
    const motoboy = await prisma.intraUser.update({
      where: { id: match.id },
      data: { active: true },
      select: { id: true, name: true },
    });
    return { ok: true as const, motoboy };
  }
  const motoboy = await prisma.intraUser.create({
    data: {
      userId,
      name: clean,
      role: "MEMBER",
      isOwner: false,
      isMotoboy: true,
      canManagePatientServices: false,
      active: true,
    },
    select: { id: true, name: true },
  });
  return { ok: true as const, motoboy };
}

export async function setMotoboyActive(id: string, active: boolean) {
  const tenant = await requireTenantId();
  if (!tenant) return { ok: false as const, error: "Sessão expirada. Entre de novo." };
  const updated = await prisma.intraUser.updateMany({
    where: { id, userId: tenant.userId, isMotoboy: true },
    data: { active },
  });
  return updated.count === 1
    ? { ok: true as const }
    : { ok: false as const, error: "Entregador não encontrado." };
}

export async function deleteMotoboy(id: string) {
  const tenant = await requireTenantId();
  if (!tenant) return { ok: false as const, error: "Sessão expirada. Entre de novo." };
  const { userId } = tenant;
  const motoboy = await prisma.intraUser.findFirst({
    where: { id, userId, isMotoboy: true },
    select: { id: true },
  });
  if (!motoboy) return { ok: false as const, error: "Entregador não encontrado." };
  const assigned = await prisma.logisticsTask.count({ where: { userId, motoboyIntraUserId: id } });
  if (assigned > 0) {
    return {
      ok: false as const,
      error: "Esse entregador já está em marcações. Inative-o para tirá-lo das rotas novas.",
    };
  }
  await prisma.intraUser.delete({ where: { id } });
  return { ok: true as const };
}

export async function listDentists() {
  const tenant = await requireTenantId();
  if (!tenant) return [];
  const { userId } = tenant;
  await ensureClientCatalog(userId);
  return prisma.dentistClient.findMany({
    where: { userId },
    orderBy: { name: "asc" },
  });
}

export async function updateClientContact(input: { id: string; address: string; phone: string }) {
  const tenant = await requireTenantId();
  if (!tenant) return { ok: false as const, error: "Sessão expirada. Entre de novo." };
  const address = input.address.trim();
  const phone = input.phone.trim().slice(0, 40);
  if (!address && !phone) return { ok: false as const, error: "Informe o endereço ou o telefone." };
  const updated = await prisma.dentistClient.updateMany({
    where: { id: input.id, userId: tenant.userId },
    data: {
      ...(address ? { address } : {}),
      ...(phone ? { phone } : {}),
    },
  });
  return updated.count === 1
    ? { ok: true as const }
    : { ok: false as const, error: "Cliente não encontrado." };
}

export async function saveDentist(input: {
  id?: string;
  name: string;
  clinicName: string;
  address: string;
  phone: string;
  routeNote: string;
  aliases: string;
}) {
  const tenant = await requireTenantId();
  if (!tenant) return { ok: false as const, error: "Sessão expirada. Entre de novo." };
  const { userId } = tenant;
  const name = input.name.trim();
  const address = input.address.trim();
  if (!name || !address) return { ok: false as const, error: "Nome e endereço são obrigatórios." };
  const data = {
    name: name.slice(0, 200),
    clinicName: input.clinicName.trim().slice(0, 200) || null,
    address,
    phone: input.phone.trim().slice(0, 40) || null,
    routeNote: input.routeNote.trim() || null,
    aliases: input.aliases
      .split(",")
      .map((alias) => alias.trim())
      .filter(Boolean)
      .slice(0, 20),
  };
  if (input.id) {
    const updated = await prisma.dentistClient.updateMany({ where: { id: input.id, userId }, data });
    return updated.count === 1
      ? { ok: true as const }
      : { ok: false as const, error: "Dentista não encontrado." };
  }
  await prisma.dentistClient.create({ data: { userId, ...data } });
  return { ok: true as const };
}
