"use server";

import { revalidatePath } from "next/cache";

import type { LogisticsDraftView, LogisticsEditPatch } from "@/server/services/logistics";
import {
  assignTaskMotoboy,
  cancelLogisticsTask,
  completeLogisticsTask,
  reopenLogisticsTask,
  confirmLogisticsIntake,
  createMotoboy,
  deleteMotoboy,
  setMotoboyActive,
  applyLogisticsEdit,
  listAgendaTasks,
  listDayTasks,
  listDentists,
  listMotoboys,
  matchDraftIdentity,
  moveLogisticsTask,
  previewDirectorySpeech,
  previewLogisticsEditCommand,
  transcribeDirectoryAudio,
  transcribeLogisticsEdit,
  updateLogisticsTask,
  registerSpokenClient,
  saveDentist,
  saveLogisticsDraft,
  updateClientContact,
  transcribeLogisticsAudio,
} from "@/server/services/logistics";

function refresh() {
  revalidatePath("/dashboard/painel");
  revalidatePath("/dashboard/dentistas");
  revalidatePath("/dashboard/agenda");
}

export async function previewDirectoryCommand(transcript: string) {
  try {
    const result = await previewDirectorySpeech(transcript);
    if (result.ok) refresh();
    return result;
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Falha ao ler o cadastro." };
  }
}

export async function previewDirectoryAudio(audio: { mimeType: string; base64: string }) {
  try {
    const result = await transcribeDirectoryAudio(audio);
    if (result.ok) refresh();
    return result;
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Falha ao transcrever o áudio." };
  }
}

export async function previewLogisticsCommand(transcript: string) {
  try {
    const result = await saveLogisticsDraft(transcript);
    if (result.ok) refresh();
    return result;
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Falha ao ler o comando." };
  }
}

export async function previewLogisticsAudio(audio: { mimeType: string; base64: string }) {
  try {
    const result = await transcribeLogisticsAudio(audio);
    if (result.ok) refresh();
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao transcrever o áudio.";
    return { ok: false as const, error: message };
  }
}

export async function refreshDraftIdentity(input: {
  clientName: string | null;
  courierName: string | null;
  createClient: boolean | null;
  createCourier: boolean | null;
  addressInput: string;
  phoneInput: string;
}) {
  return matchDraftIdentity(input);
}

export async function registerSpokenClientAction(input: { clientName: string; address: string | null; phone: string | null }) {
  const result = await registerSpokenClient(input);
  if (result.ok) refresh();
  return result;
}

export async function updateLogisticsTaskAction(input: {
  taskId: string;
  type: "ENTREGA" | "COLETA";
  clientName: string;
  targetDate: string;
  timeWindowStart: string | null;
  timeWindowEnd: string | null;
  motoboyIntraUserId: string | null;
  createClient: boolean | null;
}) {
  const result = await updateLogisticsTask(input);
  if (result.ok) refresh();
  return result;
}

export async function applyLogisticsEditAction(input: {
  taskId: string;
  patch: LogisticsEditPatch;
  createClient: boolean | null;
  createCourier: boolean | null;
}) {
  const result = await applyLogisticsEdit(input);
  if (result.ok) refresh();
  return result;
}

export async function previewLogisticsEdit(transcript: string) {
  return previewLogisticsEditCommand(transcript);
}

export async function previewLogisticsEditAudio(audio: { mimeType: string; base64: string }) {
  return transcribeLogisticsEdit(audio);
}

export async function confirmLogisticsBatch(intakeId: string, tasks: LogisticsDraftView[]) {
  const result = await confirmLogisticsIntake(intakeId, tasks);
  if (result.ok) refresh();
  return result;
}

export async function allocateMotoboy(taskId: string, motoboyIntraUserId: string) {
  const result = await assignTaskMotoboy(taskId, motoboyIntraUserId);
  if (result.ok) refresh();
  return result;
}

export async function concludeLogisticsTask(taskId: string) {
  const result = await completeLogisticsTask(taskId);
  if (result.ok) refresh();
  return result;
}

export async function cancelLogisticsTaskAction(taskId: string) {
  const result = await cancelLogisticsTask(taskId);
  if (result.ok) refresh();
  return result;
}

export async function reopenLogisticsTaskAction(taskId: string) {
  const result = await reopenLogisticsTask(taskId);
  if (result.ok) refresh();
  return result;
}

export async function loadAgenda(from: string, to: string) {
  const [tasks, motoboys] = await Promise.all([listAgendaTasks(from, to), listMotoboys()]);
  return { tasks, motoboys };
}

export async function moveAgendaTask(taskId: string, startIso: string, endIso: string) {
  const result = await moveLogisticsTask(taskId, startIso, endIso);
  if (result.ok) refresh();
  return result;
}

export async function loadPainel(date: string) {
  const [tasks, motoboys] = await Promise.all([listDayTasks(date), listMotoboys()]);
  return { tasks, motoboys };
}

export async function listLabFinanceClients() {
  const dentists = await listDentists();
  return {
    success: true as const,
    data: dentists.map((dentist) => ({ id: dentist.id, name: dentist.name })),
  };
}

export async function loadDentistDirectory() {
  const [dentists, motoboys] = await Promise.all([listDentists(), listMotoboys()]);
  return { dentists, motoboys };
}

export async function updateClientContactAction(input: { id: string; address: string; phone: string }) {
  const result = await updateClientContact(input);
  if (result.ok) refresh();
  return result;
}

export async function saveDentistAction(input: {
  id?: string;
  name: string;
  clinicName: string;
  address: string;
  phone: string;
  routeNote: string;
  aliases: string;
}) {
  const result = await saveDentist(input);
  if (result.ok) refresh();
  return result;
}

export async function setMotoboyActiveAction(id: string, active: boolean) {
  const result = await setMotoboyActive(id, active);
  if (result.ok) refresh();
  return result;
}

export async function deleteMotoboyAction(id: string) {
  const result = await deleteMotoboy(id);
  if (result.ok) refresh();
  return result;
}

export async function createMotoboyAction(name: string) {
  const result = await createMotoboy(name);
  if (result.ok) refresh();
  return result;
}
