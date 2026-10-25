"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mic } from "lucide-react";

import {
  allocateMotoboy,
  cancelLogisticsTaskAction,
  concludeLogisticsTask,
  confirmLogisticsBatch,
  discardLogisticsBatch,
  previewLogisticsAudio,
  previewLogisticsCommand,
  refreshDraftIdentity,
  registerSpokenClientAction,
} from "@/app/actions/logistics";
import { AgendaAudioRecorder } from "@/components/dashboard/AgendaAudioRecorder";
import { CallLink } from "@/components/dashboard/logistics/CallLink";
import { EditProposals } from "@/components/dashboard/logistics/EditProposals";
import { TaskEditForm } from "@/components/dashboard/logistics/TaskEditForm";
import { Button } from "@/components/ui/button";
import { brlInputToCents, centsToBrlInput } from "@/lib/logistics/money";
import type { DayTaskView, LogisticsDraftView, LogisticsEditProposal, SpokenClientDraft } from "@/server/services/logistics";

type Motoboy = { id: string; name: string; active?: boolean; phone?: string | null };

const PAYMENT_OPTIONS = [
  { value: "", label: "Não citada" },
  { value: "PIX", label: "PIX" },
  { value: "CASH", label: "Dinheiro" },
  { value: "CARD", label: "Cartão" },
  { value: "TRANSFER", label: "Transferência" },
  { value: "OTHER", label: "Outro" },
] as const;

function clockLabel(task: { timeWindowStart: string | null; timeWindowEnd: string | null }) {
  if (task.timeWindowStart && task.timeWindowEnd) return `${task.timeWindowStart}–${task.timeWindowEnd}`;
  if (task.timeWindowEnd) return `Até ${task.timeWindowEnd}`;
  if (task.timeWindowStart) return `A partir de ${task.timeWindowStart}`;
  return "Sem horário";
}

function normalizeLookup(value: string) {
  return value.trim().toLocaleLowerCase("pt-BR");
}

function couriersSharingName(heard: string | null, motoboys: Motoboy[]) {
  if (!heard?.trim()) return [];
  const key = normalizeLookup(heard);
  const active = motoboys.filter((motoboy) => motoboy.active !== false);
  const exact = active.filter((motoboy) => normalizeLookup(motoboy.name) === key);
  if (exact.length === 1) return [];
  const first = key.split(/\s+/)[0] ?? "";
  const heardParts = key.split(/\s+/).filter(Boolean);
  return active.filter((motoboy) => {
    const parts = normalizeLookup(motoboy.name).split(/\s+/).filter(Boolean);
    if (parts[0] !== first) return false;
    return heardParts.every((part) => parts.includes(part));
  });
}

function ProfessionalPicker({
  choices,
  onPick,
  onUnknown,
}: {
  choices: LogisticsDraftView["clientChoices"];
  onPick: (choice: LogisticsDraftView["clientChoices"][number]) => void;
  onUnknown: () => void;
}) {
  const [query, setQuery] = useState("");
  const needle = normalizeLookup(query);
  const visible = choices.filter((choice) =>
    normalizeLookup([choice.name, choice.clinicName ?? "", choice.address].join(" ")).includes(needle),
  );
  return (
    <div className="mt-2">
      <p className="text-sm">Há mais de um profissional com esse nome. Escolha pelo nome e pelo sobrenome.</p>
      <input
        className="depth-field mt-1 w-full px-2 py-1 text-sm"
        placeholder="Buscar profissional"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <select
        className="depth-field mt-1 w-full px-2 py-1 text-sm"
        defaultValue=""
        onChange={(event) => {
          const choice = choices.find((item) => item.id === event.target.value);
          if (choice) onPick(choice);
        }}
      >
        <option value="">Selecione o profissional</option>
        {visible.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {[choice.name, choice.clinicName, choice.address].filter(Boolean).join(" · ")}
          </option>
        ))}
      </select>
      <Button type="button" variant="outline" className="mt-2" onClick={onUnknown}>
        Não está na lista
      </Button>
    </div>
  );
}

function formatDay(iso: string) {
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return `${day}/${month}/${year}`;
}

export function DayPanel({
  date,
  tasks,
  motoboys,
  openDates,
}: {
  date: string;
  tasks: DayTaskView[];
  motoboys: Motoboy[];
  openDates: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [command, setCommand] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [intakeId, setIntakeId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<LogisticsDraftView[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingClients, setPendingClients] = useState<SpokenClientDraft[]>([]);
  const [edits, setEdits] = useState<LogisticsEditProposal[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const pendingTasks = tasks.filter((task) => task.status === "PENDENTE" || task.status === "EM_ROTA");
  const doneTasks = tasks.filter((task) => task.status === "CONCLUIDO" || task.status === "CANCELADO");
  const pills = motoboys.filter((motoboy) => motoboy.active !== false);

  async function rematchDraft(index: number, task: LogisticsDraftView) {
    const result = await refreshDraftIdentity({
      clientName: task.clientName,
      courierName: task.courierName,
      createClient: null,
      createCourier: task.courierKnown ? false : task.createCourier,
      addressInput: task.addressInput,
      phoneInput: task.phoneInput,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    patchDraft(index, result.identity);
  }

  function patchDraft(index: number, patch: Partial<LogisticsDraftView>) {
    setDrafts((current) => current?.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)) ?? null);
  }

  function discardReview(next: LogisticsDraftView[] | null) {
    if (next && next.length > 0) {
      setDrafts(next);
      return;
    }
    const id = intakeId;
    setDrafts(null);
    setIntakeId(null);
    if (!id) return;
    startTransition(async () => {
      const result = await discardLogisticsBatch(id);
      if (!result.ok) setError(result.error);
    });
  }

  function run(action: () => Promise<{ ok: boolean; error?: string; contactNotes?: string[]; targetDate?: string | null }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? "Não foi possível concluir.");
      else {
        setNotice(result.contactNotes?.join(" ") || null);
        if (result.targetDate && result.targetDate !== date) router.push(`/dashboard/painel?date=${result.targetDate}`);
        else router.refresh();
      }
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Painel do Dia</h1>
          <p className="text-sm text-muted-foreground">Coletas e entregas. Um clique aloca, um clique conclui.</p>
        </div>
        <label className="text-sm font-medium">
          Data
          <input
            type="date"
            className="depth-field ml-2 px-2 py-1"
            value={date}
            onChange={(event) => router.push(`/dashboard/painel?date=${event.target.value}`)}
          />
        </label>
      </header>

      <section className="depth-front p-4">
        <div className="mb-3 flex items-center gap-2 text-lg font-medium">
          <Mic className="h-5 w-5" />
          Comando de voz
        </div>
        <AgendaAudioRecorder
          exampleText="Hoje precisa coletar no dr. Marcelo até às cinco da tarde."
          processing={pending}
          onAudioReady={async (blob) => {
            const base64 = await blobToBase64(blob);
            const result = await previewLogisticsAudio({ mimeType: blob.type || "audio/webm", base64 });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setNotice(result.contactNotes.join(" ") || null);
            setPendingClients(result.pendingClients);
            setEdits(result.edits);
            setIntakeId(result.intakeId);
            setDrafts(result.tasks.length > 0 ? result.tasks : null);
          }}
        />
        <label className="mt-4 block text-sm font-medium">
          Ou digite o comando
          <textarea
            className="depth-field mt-1 min-h-20 w-full p-2"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder="Hoje precisa coletar no dr.Marcelo, até às cinco horas da tarde/Hoje precisa entregar até às seis da tarde"
          />
        </label>
        <Button
          className="mt-2"
          disabled={pending || !command.trim()}
          onClick={() =>
            run(async () => {
              const result = await previewLogisticsCommand(command);
              if (result.ok) {
                setPendingClients(result.pendingClients);
                setEdits(result.edits);
                setIntakeId(result.intakeId);
                setDrafts(result.tasks.length > 0 ? result.tasks : null);
              }
              return result;
            })
          }
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ler comando"}
        </Button>
        {notice ? <p className="mt-2 text-sm text-success">{notice}</p> : null}
        {pendingClients.map((client) => {
          const details = [client.address ? `o endereço ${client.address}` : null, client.phone ? `o telefone ${client.phone}` : null]
            .filter(Boolean)
            .join(" e ");
          return (
          <div key={client.clientName} className="mt-3 rounded-xl border border-warning/40 bg-warning/10 p-3">
            <RegistrationQuestion
              prompt={`Não identifiquei o cliente ${client.clientName}. Posso cadastrá-lo${details ? ` com ${details}` : ""}?`}
              answer={null}
              onAnswer={(accepted) => {
                if (!accepted) {
                  setPendingClients((current) => current.filter((item) => item.clientName !== client.clientName));
                  return;
                }
                startTransition(async () => {
                  const result = await registerSpokenClientAction(client);
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  setPendingClients((current) => current.filter((item) => item.clientName !== client.clientName));
                  setNotice(`${client.clientName} entrou no cadastro de clientes.`);
                  router.refresh();
                });
              }}
            />
          </div>
          );
        })}
        {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
      </section>

      {drafts && intakeId ? (
        <section className="rounded-2xl border border-warning/40 bg-warning/10 p-4 shadow-[var(--shadow-elevation-2)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-medium">Revisão do áudio</h2>
            <Button type="button" variant="outline" disabled={pending} onClick={() => discardReview(null)}>
              Descartar lote
            </Button>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Confira cada ordem. Descarte a que saiu errada antes de confirmar.
          </p>
          <ul className="mt-3 space-y-3">
            {drafts.map((task, index) => (
              <li key={`${task.type}-${index}`} className="depth-card p-3">
                <p className="font-medium">
                  {task.type} · {clockLabel(task)} · {task.targetDate ?? "sem data"}
                </p>
                <label className="mt-2 block text-sm">
                  Dentista ou clínica
                  <input
                    className="depth-field mt-1 w-full px-2 py-1"
                    value={task.clientName ?? ""}
                    onChange={(event) => patchDraft(index, { clientName: event.target.value })}
                    onBlur={(event) => {
                      if (event.target.value.trim() === task.rawClientName.trim()) return;
                      void rematchDraft(index, { ...task, clientName: event.target.value });
                    }}
                  />
                </label>
                {task.clientChoices.length > 0 && !task.dentistClientId ? (
                  <ProfessionalPicker
                    choices={task.clientChoices}
                    onPick={(choice) =>
                      patchDraft(index, {
                        dentistClientId: choice.id,
                        matchedName: choice.name,
                        clientName: choice.name,
                        address: choice.address,
                        phone: choice.phone,
                        createClient: false,
                        clientChoices: [],
                      })
                    }
                    onUnknown={() => patchDraft(index, { createClient: true, clientChoices: [] })}
                  />
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {task.matchedName
                      ? `${task.matchedName}${task.address ? ` · ${task.address}` : " · endereço ainda vazio"}${task.phone ? ` · ${task.phone}` : " · telefone ainda vazio"}`
                      : "Não identifiquei esse cliente pelo nome."}
                  </p>
                )}
                {!task.dentistClientId && task.rawClientName && task.clientChoices.length === 0 ? (
                  <RegistrationQuestion
                    prompt={`Não identifiquei o cliente ${task.rawClientName}. Posso cadastrá-lo como um novo cliente?`}
                    answer={task.createClient}
                    onAnswer={(createClient) => patchDraft(index, { createClient })}
                  />
                ) : null}
                {task.createClient === true || (task.matchedName && (!task.address || !task.phone)) ? (
                  <div className="mt-2 grid gap-2">
                    <input
                      className="depth-field px-2 py-1 text-sm"
                      placeholder="Endereço, se quiser completar agora"
                      value={task.addressInput}
                      onChange={(event) => patchDraft(index, { addressInput: event.target.value })}
                    />
                    <input
                      className="depth-field px-2 py-1 text-sm"
                      placeholder="Telefone, se quiser completar agora"
                      value={task.phoneInput}
                      onChange={(event) => patchDraft(index, { phoneInput: event.target.value })}
                    />
                  </div>
                ) : null}
                <label className="mt-2 block text-sm">
                  Entregador
                  <select
                    className="depth-field mt-1 w-full px-2 py-1"
                    value={task.motoboyIntraUserId ?? ""}
                    onChange={(event) => {
                      const motoboy = pills.find((item) => item.id === event.target.value);
                      patchDraft(index, motoboy
                        ? { courierName: motoboy.name, motoboyIntraUserId: motoboy.id, courierKnown: true, createCourier: false }
                        : { courierName: null, motoboyIntraUserId: null, courierKnown: false, createCourier: false });
                    }}
                  >
                    <option value="">Sem entregador</option>
                    {pills.map((motoboy) => (
                      <option key={motoboy.id} value={motoboy.id}>
                        {motoboy.phone ? `${motoboy.name} · ${motoboy.phone}` : motoboy.name}
                      </option>
                    ))}
                  </select>
                </label>
                {task.courierName && !task.motoboyIntraUserId ? (
                  <p className="mt-1 text-sm">
                    {couriersSharingName(task.courierName, pills).length > 1
                      ? `Há mais de um entregador chamado ${task.courierName}. Escolha qual é.`
                      : `Não identifiquei o entregador ${task.courierName}.`}
                  </p>
                ) : task.courierKnown && task.courierName ? (
                  <p className="mt-1 text-sm text-muted-foreground">Entregador {task.courierName} já está no cadastro.</p>
                ) : null}
                {task.courierName && !task.courierKnown && couriersSharingName(task.courierName, pills).length === 0 ? (
                  <RegistrationQuestion
                    prompt={`Não identifiquei o entregador ${task.courierName}. Posso cadastrá-lo como um novo entregador?`}
                    answer={task.createCourier}
                    onAnswer={(createCourier) => patchDraft(index, { createCourier })}
                  />
                ) : null}
                <label className="mt-2 block text-sm">
                  Valor (R$) — entra no Financeiro
                  <input
                    className="depth-field mt-1 w-full px-2 py-1"
                    inputMode="decimal"
                    placeholder="0,00"
                    defaultValue={centsToBrlInput(task.amountCents)}
                    onBlur={(event) => patchDraft(index, { amountCents: brlInputToCents(event.target.value) })}
                  />
                </label>
                <label className="mt-2 block text-sm">
                  Forma de pagamento
                  <select
                    className="depth-field mt-1 w-full px-2 py-1"
                    value={task.paymentMethod ?? ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      const paymentMethod = PAYMENT_OPTIONS.some((option) => option.value === value && value !== "")
                        ? (value as NonNullable<LogisticsDraftView["paymentMethod"]>)
                        : null;
                      patchDraft(index, { paymentMethod });
                    }}
                  >
                    {PAYMENT_OPTIONS.map((option) => (
                      <option key={option.value || "none"} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="mt-1 text-xs text-muted-foreground">
                  {task.amountCents
                    ? "Este valor entra no Financeiro ao confirmar."
                    : "Sem valor, esta ordem fica só na agenda."}{" "}
                  Coletas, entregas e a data ficam na agenda.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3"
                  disabled={pending}
                  onClick={() => discardReview(drafts.filter((_, itemIndex) => itemIndex !== index))}
                >
                  Descartar esta ordem
                </Button>
              </li>
            ))}
          </ul>
          <Button
            className="mt-3"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const result = await confirmLogisticsBatch(intakeId, drafts);
                if (result.ok) {
                  setDrafts(null);
                  setIntakeId(null);
                  setCommand("");
                  const finance = result.financeCount;
                  const day = result.targetDate ? formatDay(result.targetDate) : null;
                  const placed = day ? `${result.count} ordem(ns) na agenda de ${day}, em pendentes.` : `${result.count} ordem(ns) na agenda.`;
                  return {
                    ok: true as const,
                    targetDate: result.targetDate,
                    contactNotes: [finance > 0 ? `${placed} ${finance} valor(es) no Financeiro.` : placed],
                  };
                }
                return result;
              })
            }
          >
            Confirmar lote
          </Button>
        </section>
      ) : null}

      <EditProposals
        proposals={edits}
        onApplied={(taskId) => {
          const proposal = edits.find((item) => item.taskId === taskId);
          setEdits((current) => current.filter((item) => item.taskId !== taskId));
          setNotice("Marcação atualizada no painel e na agenda.");
          if (proposal?.targetDate && proposal.targetDate !== date) router.push(`/dashboard/painel?date=${proposal.targetDate}`);
          else router.refresh();
        }}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <TaskColumn title="Pendentes" empty={openDates.length > 0 ? "" : "Nada pendente neste dia."}>
          {pendingTasks.length === 0 && openDates.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              Nada pendente neste dia. Há pendências em{" "}
              {openDates.map((openDate, index) => (
                <span key={openDate}>
                  {index > 0 ? ", " : null}
                  <button type="button" className="font-medium text-primary underline" onClick={() => router.push(`/dashboard/painel?date=${openDate}`)}>
                    {formatDay(openDate)}
                  </button>
                </span>
              ))}
              .
            </p>
          ) : null}
          {pendingTasks.map((task) => (
            <article key={task.id} className="depth-card p-4">
              {editingId === task.id ? (
                <TaskEditForm
                  task={{
                    id: task.id,
                    type: task.type,
                    clientName: task.matchedName ?? task.rawClientName,
                    targetDate: date,
                    timeWindowStart: task.timeWindowStart,
                    timeWindowEnd: task.timeWindowEnd,
                    motoboyIntraUserId: task.motoboyIntraUserId,
                    status: task.status,
                  }}
                  motoboys={pills}
                  onClose={() => setEditingId(null)}
                  onSaved={(nextDate) => {
                    setEditingId(null);
                    if (nextDate !== date) router.push(`/dashboard/painel?date=${nextDate}`);
                    else router.refresh();
                  }}
                />
              ) : (
                <>
                  <p className={task.type === "ENTREGA" ? "badge-entrega" : "badge-coleta"}>
                    {task.type}
                  </p>
                  <p className="text-xl font-semibold">{clockLabel(task)}</p>
                  <p>{task.matchedName ?? task.rawClientName}</p>
                  {task.createdByName ? (
                    <p className="text-xs text-muted-foreground">Criada por {task.createdByName}</p>
                  ) : null}
                  {task.address ? <p className="text-sm text-muted-foreground">{task.address}</p> : null}
                  {task.clientPhone ? (
                    <CallLink phone={task.clientPhone} who={task.matchedName ?? task.rawClientName} />
                  ) : (
                    <p className="text-sm text-muted-foreground">Cliente sem telefone</p>
                  )}
                  {task.workDescription ? <p className="text-sm">{task.workDescription}</p> : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {pills.map((motoboy) => (
                      <Button
                        key={motoboy.id}
                        variant={task.motoboyIntraUserId === motoboy.id ? "default" : "outline"}
                        disabled={pending}
                        onClick={() => run(() => allocateMotoboy(task.id, motoboy.id))}
                      >
                        {motoboy.name}
                      </Button>
                    ))}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {task.motoboyName ? `Entregador ${task.motoboyName}` : "Sem entregador"}
                    {task.status === "EM_ROTA" ? " · Em rota" : ""}
                  </p>
                  {task.motoboyName ? (
                    task.motoboyPhone ? (
                      <CallLink phone={task.motoboyPhone} who={task.motoboyName} />
                    ) : (
                      <p className="text-sm text-muted-foreground">Entregador sem telefone</p>
                    )
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="outline" disabled={pending} onClick={() => setEditingId(task.id)}>
                      Editar
                    </Button>
                    <Button disabled={pending} onClick={() => run(() => concludeLogisticsTask(task.id))}>
                      Realizada
                    </Button>
                    <Button variant="outline" disabled={pending} onClick={() => run(() => cancelLogisticsTaskAction(task.id))}>
                      Cancelar
                    </Button>
                  </div>
                </>
              )}
            </article>
          ))}
        </TaskColumn>
        <TaskColumn title="Realizadas e canceladas" empty="Nada encerrado neste dia.">
          {doneTasks.map((task) => (
            <article key={task.id} className="depth-settled p-4">
              {editingId === task.id ? (
                <TaskEditForm
                  task={{
                    id: task.id,
                    type: task.type,
                    clientName: task.matchedName ?? task.rawClientName,
                    targetDate: date,
                    timeWindowStart: task.timeWindowStart,
                    timeWindowEnd: task.timeWindowEnd,
                    motoboyIntraUserId: task.motoboyIntraUserId,
                    status: task.status,
                  }}
                  motoboys={pills}
                  onClose={() => setEditingId(null)}
                  onSaved={(nextDate) => {
                    setEditingId(null);
                    if (nextDate !== date) router.push(`/dashboard/painel?date=${nextDate}`);
                    else router.refresh();
                  }}
                />
              ) : (
                <>
                  <p className={task.type === "ENTREGA" ? "badge-entrega" : "badge-coleta"}>{task.type}</p>
                  <p>{task.matchedName ?? task.rawClientName}</p>
                  {task.createdByName ? (
                    <p className="text-xs text-muted-foreground">Criada por {task.createdByName}</p>
                  ) : null}
                  <p className="text-sm text-muted-foreground">
                    {task.status === "CANCELADO" ? "Cancelada" : "Realizada"}
                    {" · "}
                    {clockLabel(task)}
                    {task.motoboyName ? ` · Entregador ${task.motoboyName}` : ""}
                  </p>
                  {task.clientPhone ? (
                    <CallLink phone={task.clientPhone} who={task.matchedName ?? task.rawClientName} />
                  ) : (
                    <p className="text-sm text-muted-foreground">Cliente sem telefone</p>
                  )}
                  {task.motoboyName && task.motoboyPhone ? (
                    <CallLink phone={task.motoboyPhone} who={task.motoboyName} />
                  ) : task.motoboyName ? (
                    <p className="text-sm text-muted-foreground">Entregador sem telefone</p>
                  ) : null}
                  <Button className="mt-3" variant="outline" disabled={pending} onClick={() => setEditingId(task.id)}>
                    Editar
                  </Button>
                </>
              )}
            </article>
          ))}
        </TaskColumn>
      </div>
    </div>
  );
}

function RegistrationQuestion({
  prompt,
  answer,
  onAnswer,
}: {
  prompt: string;
  answer: boolean | null;
  onAnswer: (answer: boolean) => void;
}) {
  return (
    <div className="mt-2 rounded-lg bg-warning/15 p-2 text-sm">
      <p>{prompt}</p>
      <div className="mt-2 flex gap-2">
        <Button type="button" variant={answer === true ? "default" : "outline"} onClick={() => onAnswer(true)}>
          Sim, cadastrar
        </Button>
        <Button type="button" variant={answer === false ? "default" : "outline"} onClick={() => onAnswer(false)}>
          Não, descartar o cadastro
        </Button>
      </div>
    </div>
  );
}

function TaskColumn({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const list = Array.isArray(children) ? children : [children];
  const hasItems = list.some(Boolean);
  return (
    <section className="depth-well">
      <h2 className="mb-3 px-1 text-lg font-semibold">{title}</h2>
      <div className="space-y-3">{hasItems ? children : <p className="text-sm text-muted-foreground">{empty}</p>}</div>
    </section>
  );
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}
