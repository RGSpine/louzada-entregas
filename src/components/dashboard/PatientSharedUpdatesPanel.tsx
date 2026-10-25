"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  getChartSharedUpdates,
  inviteChartPatientToMap,
  openMapWhatsAppInvite,
  reviewSharedUpdate,
} from "@/app/actions/professional-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const KIND_LABEL: Record<string, string> = {
  JOURNAL: "Relato",
  CONSULTATION: "Consulta",
  EXAM: "Exame",
};

export function PatientSharedUpdatesPanel({ patientId }: { patientId: string }) {
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [updates, setUpdates] = useState<
    {
      id: string;
      kind: string;
      title: string;
      body: string;
      status: string;
      createdAt: string;
    }[]
  >([]);

  function reload() {
    startTransition(async () => {
      const result = await getChartSharedUpdates(patientId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setEmail(result.email);
      setPhone(result.phone ?? "");
      setUpdates(result.updates);
    });
  }

  useEffect(() => {
    reload();
    // carregamento inicial da aba
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  function review(updateId: string, attach: boolean) {
    startTransition(async () => {
      const result = await reviewSharedUpdate({ updateId, attach });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(attach ? "Informação vinculada à ficha." : "Informação dispensada.");
      reload();
    });
  }

  function invite() {
    if (!email) return;
    startTransition(async () => {
      const result = await inviteChartPatientToMap({ email });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.already ? "Este paciente já está vinculado." : "Convite enviado ao paciente.",
      );
    });
  }

  function sendWhatsApp() {
    startTransition(async () => {
      const result = await openMapWhatsAppInvite({ chartPatientId: patientId, phone });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      window.location.href = result.whatsappUrl;
    });
  }

  const inbox = updates.filter((item) => item.status === "INBOX");
  const attached = updates.filter((item) => item.status === "ATTACHED");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Informações do mapa</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            O que o paciente autorizou no Mapa de Saúde. Se a ficha já existia, você escolhe
            se incorpora à página principal.
          </p>
        </div>
        {email ? (
          <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={invite}>
            Convidar para vincular
          </Button>
        ) : null}
      </div>

      <div className="rounded-xl border border-border bg-muted/30 p-4">
        <p className="text-sm font-medium text-foreground">Paciente ainda sem conta</p>
        <p className="mt-1 text-sm text-muted-foreground">
          O WhatsApp abre com o convite. Ao se cadastrar, a conta fica vinculada a você.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className="h-11"
            inputMode="tel"
            placeholder="WhatsApp com DDD"
            aria-label="WhatsApp do paciente"
          />
          <Button type="button" className="min-h-11" disabled={pending} onClick={sendWhatsApp}>
            Enviar pelo WhatsApp
          </Button>
        </div>
      </div>

      {inbox.length === 0 && attached.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma informação compartilhada ainda.</p>
      ) : null}

      {inbox.length > 0 ? (
        <ul className="space-y-3">
          {inbox.map((item) => (
            <li key={item.id} className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">
                {KIND_LABEL[item.kind] ?? item.kind} ·{" "}
                {new Date(item.createdAt).toLocaleString("pt-BR")}
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">{item.title}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{item.body}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" className="min-h-11" disabled={pending} onClick={() => review(item.id, true)}>
                  Vincular à ficha
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={pending}
                  onClick={() => review(item.id, false)}
                >
                  Não vincular
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {attached.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold text-foreground">Já na ficha</h3>
          <ul className="mt-2 space-y-2">
            {attached.map((item) => (
              <li key={item.id} className="rounded-xl border border-border px-3 py-2">
                <p className="text-xs text-muted-foreground">{KIND_LABEL[item.kind] ?? item.kind}</p>
                <p className="text-sm font-medium text-foreground">{item.title}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{item.body}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
