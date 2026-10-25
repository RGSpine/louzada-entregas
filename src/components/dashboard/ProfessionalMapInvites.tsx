"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { openMapWhatsAppInvite } from "@/app/actions/professional-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type PatientRow = { id: string; name: string; phone: string | null };

export function ProfessionalMapInvites({
  professionalName,
  patients,
}: {
  professionalName: string;
  patients: PatientRow[];
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [phones, setPhones] = useState<Record<string, string>>(() =>
    Object.fromEntries(patients.map((patient) => [patient.id, patient.phone ?? ""])),
  );
  const [, startTransition] = useTransition();

  function send(patientId: string) {
    const phone = phones[patientId]?.trim() ?? "";
    setPendingId(patientId);
    startTransition(async () => {
      const result = await openMapWhatsAppInvite({ chartPatientId: patientId, phone });
      setPendingId(null);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      window.location.href = result.whatsappUrl;
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-8">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Convites pelo WhatsApp</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {professionalName}, estes pacientes ainda não têm conta no Mapa de Saúde. O
          WhatsApp abre com a mensagem pronta. Quando a pessoa se cadastrar, fica
          vinculada a você.
        </p>
      </header>
      {patients.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          Todos os pacientes da sua lista já têm conta, ou ainda não há fichas.
        </p>
      ) : (
        <ul className="space-y-3">
          {patients.map((patient) => (
            <li key={patient.id} className="rounded-xl border border-border bg-card p-4">
              <p className="text-sm font-semibold text-foreground">{patient.name}</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Input
                  value={phones[patient.id] ?? ""}
                  onChange={(event) =>
                    setPhones((current) => ({ ...current, [patient.id]: event.target.value }))
                  }
                  className="h-11"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="WhatsApp com DDD"
                  aria-label={`WhatsApp de ${patient.name}`}
                />
                <Button
                  type="button"
                  className="min-h-11"
                  disabled={pendingId === patient.id}
                  onClick={() => send(patient.id)}
                >
                  {pendingId === patient.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : null}
                  Enviar pelo WhatsApp
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
