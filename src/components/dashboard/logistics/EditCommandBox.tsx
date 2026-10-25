"use client";

import { useState, useTransition } from "react";
import { Loader2, Mic } from "lucide-react";

import { previewLogisticsEdit, previewLogisticsEditAudio } from "@/app/actions/logistics";
import { AgendaAudioRecorder } from "@/components/dashboard/AgendaAudioRecorder";
import { EditProposals } from "@/components/dashboard/logistics/EditProposals";
import { Button } from "@/components/ui/button";
import type { LogisticsEditProposal } from "@/server/services/logistics";

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export function EditCommandBox({ onChanged }: { onChanged: () => void }) {
  const [pending, startTransition] = useTransition();
  const [command, setCommand] = useState("");
  const [edits, setEdits] = useState<LogisticsEditProposal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function accept(next: LogisticsEditProposal[], transcript?: string) {
    setEdits(next);
    setNotice(transcript ? `Ouvi: ${transcript}` : null);
    setError(null);
  }

  return (
    <section className="depth-front p-4">
      <div className="mb-3 flex items-center gap-2 text-lg font-medium">
        <Mic className="h-5 w-5" />
        Alterar por voz ou texto
      </div>
      <AgendaAudioRecorder
        exampleText="Muda a coleta do Rodrigo para amanhã às cinco da tarde."
        processing={pending}
        onAudioReady={(blob) => {
          startTransition(async () => {
            const base64 = await blobToBase64(blob);
            const result = await previewLogisticsEditAudio({ mimeType: blob.type || "audio/webm", base64 });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            accept(result.edits, result.transcript);
          });
        }}
      />
      <label className="mt-4 block text-sm font-medium">
        Ou digite a alteração
        <textarea
          className="depth-field mt-1 min-h-16 w-full p-2"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder="Troca o entregador da coleta do Rodrigo para Roberto"
        />
      </label>
      <Button
        className="mt-2"
        disabled={pending || !command.trim()}
        onClick={() => {
          startTransition(async () => {
            const result = await previewLogisticsEdit(command);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            accept(result.edits);
            setCommand("");
          });
        }}
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ler alteração"}
      </Button>
      {notice ? <p className="mt-2 text-sm text-muted-foreground">{notice}</p> : null}
      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
      <div className="mt-3">
        <EditProposals
          proposals={edits}
          onApplied={(taskId) => {
            setEdits((current) => current.filter((item) => item.taskId !== taskId));
            setNotice("Marcação atualizada no painel e na agenda.");
            onChanged();
          }}
        />
      </div>
    </section>
  );
}
