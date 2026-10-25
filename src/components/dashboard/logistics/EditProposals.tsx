"use client";

import { useState, useTransition } from "react";

import { applyLogisticsEditAction } from "@/app/actions/logistics";
import { Button } from "@/components/ui/button";
import type { LogisticsEditProposal } from "@/server/services/logistics";

export function EditProposals({
  proposals,
  onApplied,
}: {
  proposals: LogisticsEditProposal[];
  onApplied: (taskId: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pendingAsk, setPendingAsk] = useState<{ taskId: string; kind: "client" | "courier" } | null>(null);
  const [answers, setAnswers] = useState<Record<string, { createClient: boolean | null; createCourier: boolean | null }>>({});

  function apply(proposal: LogisticsEditProposal, createClient: boolean | null, createCourier: boolean | null) {
    const previous = answers[proposal.taskId] ?? { createClient: null, createCourier: null };
    const next = {
      createClient: createClient ?? previous.createClient,
      createCourier: createCourier ?? previous.createCourier,
    };
    setAnswers((current) => ({ ...current, [proposal.taskId]: next }));
    setError(null);
    startTransition(async () => {
      const result = await applyLogisticsEditAction({
        taskId: proposal.taskId,
        patch: proposal.patch,
        createClient: next.createClient,
        createCourier: next.createCourier,
      });
      if (!result.ok && result.askClient) {
        setPendingAsk({ taskId: proposal.taskId, kind: "client" });
        setError(result.error);
        return;
      }
      if (!result.ok && result.askCourier) {
        setPendingAsk({ taskId: proposal.taskId, kind: "courier" });
        setError(result.error);
        return;
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPendingAsk(null);
      onApplied(proposal.taskId);
    });
  }

  if (proposals.length === 0) return null;
  return (
    <section className="rounded-2xl border border-primary/25 bg-primary/5 p-4 shadow-[var(--shadow-elevation-2)]">
      <h2 className="text-lg font-medium">Atualizar marcação</h2>
      <ul className="mt-3 space-y-3">
        {proposals.map((proposal) => (
          <li key={proposal.taskId} className="depth-card p-3 text-sm">
            <p>{proposal.label}</p>
            <p className="mt-1 font-medium">{proposal.change}</p>
            {pendingAsk?.taskId === proposal.taskId ? (
              <div className="mt-2 flex gap-2">
                <Button type="button" disabled={pending} onClick={() => apply(proposal, pendingAsk.kind === "client" ? true : null, pendingAsk.kind === "courier" ? true : null)}>
                  Sim, cadastrar
                </Button>
                <Button type="button" variant="outline" disabled={pending} onClick={() => apply(proposal, pendingAsk.kind === "client" ? false : null, pendingAsk.kind === "courier" ? false : null)}>
                  Não, descartar o cadastro
                </Button>
              </div>
            ) : (
              <Button className="mt-2" type="button" disabled={pending} onClick={() => apply(proposal, null, null)}>
                Aplicar nesta marcação
              </Button>
            )}
          </li>
        ))}
      </ul>
      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
    </section>
  );
}
