"use client";

import { useState, useTransition } from "react";

import {
  cancelLogisticsTaskAction,
  concludeLogisticsTask,
  reopenLogisticsTaskAction,
  updateLogisticsTaskAction,
} from "@/app/actions/logistics";
import { Button } from "@/components/ui/button";

type Motoboy = { id: string; name: string; active?: boolean };

export function TaskEditForm({
  task,
  motoboys,
  onClose,
  onSaved,
}: {
  task: {
    id: string;
    type: "ENTREGA" | "COLETA";
    clientName: string;
    targetDate: string;
    timeWindowStart: string | null;
    timeWindowEnd: string | null;
    motoboyIntraUserId: string | null;
    status: "PENDENTE" | "EM_ROTA" | "CONCLUIDO" | "CANCELADO";
  };
  motoboys: Motoboy[];
  onClose: () => void;
  onSaved: (targetDate: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState(task.type);
  const [clientName, setClientName] = useState(task.clientName);
  const [targetDate, setTargetDate] = useState(task.targetDate);
  const [timeWindowStart, setTimeWindowStart] = useState(task.timeWindowStart ?? "");
  const [timeWindowEnd, setTimeWindowEnd] = useState(task.timeWindowEnd ?? "");
  const [motoboyIntraUserId, setMotoboyIntraUserId] = useState(task.motoboyIntraUserId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [askClient, setAskClient] = useState(false);

  function save(createClient: boolean | null) {
    setError(null);
    startTransition(async () => {
      const result = await updateLogisticsTaskAction({
        taskId: task.id,
        type,
        clientName,
        targetDate,
        timeWindowStart: timeWindowStart || null,
        timeWindowEnd: timeWindowEnd || null,
        motoboyIntraUserId: motoboyIntraUserId || null,
        createClient,
      });
      if (!result.ok) {
        setAskClient(result.askClient);
        setError(result.error);
        return;
      }
      onSaved(targetDate);
    });
  }

  function changeStatus(action: "done" | "cancel" | "reopen") {
    setError(null);
    startTransition(async () => {
      const result =
        action === "done"
          ? await concludeLogisticsTask(task.id)
          : action === "cancel"
            ? await cancelLogisticsTaskAction(task.id)
            : await reopenLogisticsTaskAction(task.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved(targetDate);
    });
  }

  const open = task.status === "PENDENTE" || task.status === "EM_ROTA";
  const statusLabel =
    task.status === "CONCLUIDO"
      ? "Realizada"
      : task.status === "CANCELADO"
        ? "Cancelada"
        : task.status === "EM_ROTA"
          ? "Em rota"
          : "Pendente";

  return (
    <div className="depth-card grid gap-2 p-3">
      <p className="text-sm font-medium">Editar marcação · {statusLabel}</p>
      <label className="text-sm">
        Tipo
        <select className="depth-field mt-1 w-full px-2 py-1" value={type} onChange={(event) => setType(event.target.value as "ENTREGA" | "COLETA")}>
          <option value="COLETA">Coleta</option>
          <option value="ENTREGA">Entrega</option>
        </select>
      </label>
      <label className="text-sm">
        Cliente
        <input className="depth-field mt-1 w-full px-2 py-1" value={clientName} onChange={(event) => { setClientName(event.target.value); setAskClient(false); }} />
      </label>
      <label className="text-sm">
        Entregador
        <select className="depth-field mt-1 w-full px-2 py-1" value={motoboyIntraUserId} onChange={(event) => setMotoboyIntraUserId(event.target.value)}>
          <option value="">Sem entregador</option>
          {motoboys.filter((motoboy) => motoboy.active !== false || motoboy.id === motoboyIntraUserId).map((motoboy) => (
            <option key={motoboy.id} value={motoboy.id} disabled={motoboy.active === false}>
              {motoboy.name}{motoboy.active === false ? " (inativo)" : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Data
        <input type="date" className="depth-field mt-1 w-full px-2 py-1" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm">
          Início
          <input type="time" className="depth-field mt-1 w-full px-2 py-1" value={timeWindowStart} onChange={(event) => setTimeWindowStart(event.target.value)} />
        </label>
        <label className="text-sm">
          Limite
          <input type="time" className="depth-field mt-1 w-full px-2 py-1" value={timeWindowEnd} onChange={(event) => setTimeWindowEnd(event.target.value)} />
        </label>
      </div>
      {askClient ? (
        <div className="flex gap-2">
          <Button type="button" disabled={pending} onClick={() => save(true)}>Sim, cadastrar</Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => save(false)}>Não, descartar o cadastro</Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={pending || !clientName.trim() || !targetDate} onClick={() => save(null)}>Salvar</Button>
          {open ? (
            <Button type="button" disabled={pending} onClick={() => changeStatus("done")}>Marcar como realizada</Button>
          ) : (
            <Button type="button" variant="outline" disabled={pending} onClick={() => changeStatus("reopen")}>Voltar para pendente</Button>
          )}
          {open ? (
            <Button type="button" variant="outline" disabled={pending} onClick={() => changeStatus("cancel")}>Cancelar marcação</Button>
          ) : null}
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>Fechar</Button>
        </div>
      )}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
