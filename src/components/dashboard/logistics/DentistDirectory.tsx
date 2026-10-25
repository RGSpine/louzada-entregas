"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mic } from "lucide-react";

import {
  createMotoboyAction,
  deleteMotoboyAction,
  setMotoboyActiveAction,
  previewDirectoryAudio,
  previewDirectoryCommand,
  registerSpokenClientAction,
  saveDentistAction,
  updateClientContactAction,
} from "@/app/actions/logistics";
import { AgendaAudioRecorder } from "@/components/dashboard/AgendaAudioRecorder";
import { Button } from "@/components/ui/button";
import type { SpokenClientDraft } from "@/server/services/logistics";

type Dentist = {
  id: string;
  name: string;
  clinicName: string | null;
  address: string;
  phone: string | null;
  routeNote: string | null;
  aliases: string[];
};

type Tab = "clientes" | "entregadores";

export function DentistDirectory({
  dentists,
  motoboys,
}: {
  dentists: Dentist[];
  motoboys: Array<{ id: string; name: string; active: boolean }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>("clientes");
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [pendingClients, setPendingClients] = useState<SpokenClientDraft[]>([]);
  const [pendingCouriers, setPendingCouriers] = useState<string[]>([]);
  const [command, setCommand] = useState("");
  const [form, setForm] = useState({
    name: "",
    clinicName: "",
    address: "",
    phone: "",
    routeNote: "",
    aliases: "",
  });
  const [motoboyName, setMotoboyName] = useState("");
  const [query, setQuery] = useState("");
  const [courierQuery, setCourierQuery] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);

  const visibleDentists = dentists.filter((dentist) => {
    const missing = !dentist.address.trim() || !dentist.phone?.trim();
    if (onlyMissing && !missing) return false;
    const term = query.trim().toLocaleLowerCase("pt-BR");
    if (!term) return true;
    const haystack = [dentist.name, dentist.clinicName, dentist.address, dentist.phone, dentist.aliases.join(" ")]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("pt-BR");
    return haystack.includes(term);
  });
  const visibleCouriers = motoboys.filter((motoboy) => {
    const term = courierQuery.trim().toLocaleLowerCase("pt-BR");
    if (!term) return true;
    return motoboy.name.toLocaleLowerCase("pt-BR").includes(term);
  });
  const missingCount = dentists.filter((dentist) => !dentist.address.trim() || !dentist.phone?.trim()).length;

  function applyHeard(result: {
    ok: true;
    notes: string[];
    pendingClients: SpokenClientDraft[];
    pendingCouriers: string[];
  }) {
    setNotes(result.notes);
    setPendingClients(result.pendingClients);
    setPendingCouriers(result.pendingCouriers);
    if (result.pendingCouriers.length > 0 && result.pendingClients.length === 0) setTab("entregadores");
    if (result.pendingClients.length > 0) setTab("clientes");
    router.refresh();
  }

  function saveDentist() {
    setError(null);
    startTransition(async () => {
      const result = await saveDentistAction(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setForm({ name: "", clinicName: "", address: "", phone: "", routeNote: "", aliases: "" });
      router.refresh();
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6">
      <header>
        <h1 className="text-2xl font-semibold">Cadastros</h1>
        <p className="text-sm text-muted-foreground">
          Clientes recebem coleta e entrega. Entregadores são poucos e ficam numa lista separada.
        </p>
      </header>

      <div className="flex gap-2">
        <Button type="button" variant={tab === "clientes" ? "default" : "outline"} onClick={() => setTab("clientes")}>
          Clientes
        </Button>
        <Button type="button" variant={tab === "entregadores" ? "default" : "outline"} onClick={() => setTab("entregadores")}>
          Entregadores
        </Button>
      </div>

      <section className="depth-front p-4">
        <div className="mb-3 flex items-center gap-2 text-lg font-medium">
          <Mic className="h-5 w-5" />
          Cadastrar por áudio
        </div>
        <AgendaAudioRecorder
          exampleText={
            tab === "clientes"
              ? "Cadastra o cliente Marcelo, o endereço é Rua A, 10 e o telefone é 11 98888-7766."
              : "Cadastra o entregador Roberto."
          }
          processing={pending}
          onAudioReady={async (blob) => {
            const base64 = await blobToBase64(blob);
            const result = await previewDirectoryAudio({ mimeType: blob.type || "audio/webm", base64 });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setError(null);
            applyHeard(result);
          }}
        />
        <label className="mt-4 block text-sm font-medium">
          Ou digite o cadastro
          <textarea
            className="depth-field mt-1 min-h-20 w-full p-2"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder={
              tab === "clientes"
                ? "O endereço do Marcelo é Rua A, 10."
                : "Cadastra o entregador Roberto."
            }
          />
        </label>
        <Button
          className="mt-2"
          disabled={pending || !command.trim()}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await previewDirectoryCommand(command);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setCommand("");
              applyHeard(result);
            });
          }}
        >
          Ler cadastro
        </Button>
        {notes.map((note) => (
          <p key={note} className="mt-2 text-sm text-success">{note}</p>
        ))}
        {pendingClients.map((client) => {
          const details = [client.address ? `endereço ${client.address}` : null, client.phone ? `telefone ${client.phone}` : null]
            .filter(Boolean)
            .join(" e ");
          return (
            <div key={client.clientName} className="mt-3 rounded-xl border border-warning/40 bg-warning/10 p-3">
              <p className="text-sm">
                Não identifiquei o cliente {client.clientName}. Posso cadastrá-lo{details ? ` com ${details}` : ""}?
              </p>
              <div className="mt-2 flex gap-2">
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    startTransition(async () => {
                      const result = await registerSpokenClientAction(client);
                      if (!result.ok) {
                        setError(result.error);
                        return;
                      }
                      setPendingClients((current) => current.filter((item) => item.clientName !== client.clientName));
                      setNotes([`${client.clientName} entrou no cadastro de clientes.`]);
                      router.refresh();
                    });
                  }}
                >
                  Sim, cadastrar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => setPendingClients((current) => current.filter((item) => item.clientName !== client.clientName))}
                >
                  Não, descartar o cadastro
                </Button>
              </div>
            </div>
          );
        })}
        {pendingCouriers.map((name) => (
          <div key={name} className="mt-3 rounded-xl border border-warning/40 bg-warning/10 p-3">
            <p className="text-sm">Não identifiquei o entregador {name}. Posso cadastrá-lo?</p>
            <div className="mt-2 flex gap-2">
              <Button
                type="button"
                disabled={pending}
                onClick={() => {
                  startTransition(async () => {
                    const result = await createMotoboyAction(name);
                    if (!result.ok) {
                      setError(result.error);
                      return;
                    }
                    setPendingCouriers((current) => current.filter((item) => item !== name));
                    setNotes([`${name} entrou no cadastro de entregadores.`]);
                    setTab("entregadores");
                    router.refresh();
                  });
                }}
              >
                Sim, cadastrar
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setPendingCouriers((current) => current.filter((item) => item !== name))}
              >
                Não, descartar o cadastro
              </Button>
            </div>
          </div>
        ))}
        {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
      </section>

      {tab === "clientes" ? (
        <>
          <section className="depth-card p-4">
            <h2 className="font-medium">Clientes</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {dentists.length} no cadastro. {missingCount} ainda sem endereço, sem telefone, ou sem os dois.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                className="depth-field min-w-48 flex-1 px-2 py-1"
                placeholder="Buscar cliente pelo nome"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <Button type="button" variant={onlyMissing ? "default" : "outline"} onClick={() => setOnlyMissing((current) => !current)}>
                Só incompletos
              </Button>
            </div>
          </section>
          {visibleDentists.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum cliente com esse nome.</p>
          ) : (
            <ol className="depth-well space-y-3">
              {visibleDentists.map((dentist) => (
                <ClientContactCard key={dentist.id} dentist={dentist} index={dentists.indexOf(dentist) + 1} />
              ))}
            </ol>
          )}
          <section className="depth-card p-4">
            <h2 className="font-medium">Novo cliente</h2>
            <div className="mt-3 grid gap-2">
              <input className="depth-field px-2 py-1" placeholder="Nome" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              <input className="depth-field px-2 py-1" placeholder="Clínica" value={form.clinicName} onChange={(event) => setForm({ ...form, clinicName: event.target.value })} />
              <input className="depth-field px-2 py-1" placeholder="Endereço" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />
              <input className="depth-field px-2 py-1" placeholder="Telefone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
              <input className="depth-field px-2 py-1" placeholder="Nota de rota" value={form.routeNote} onChange={(event) => setForm({ ...form, routeNote: event.target.value })} />
              <input className="depth-field px-2 py-1" placeholder="Apelidos, separados por vírgula" value={form.aliases} onChange={(event) => setForm({ ...form, aliases: event.target.value })} />
              <Button disabled={pending || !form.name.trim()} onClick={saveDentist}>Salvar cliente</Button>
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="depth-card p-4">
            <h2 className="font-medium">Entregadores</h2>
            <p className="mt-1 text-sm text-muted-foreground">{motoboys.length} no cadastro.</p>
            <input
              className="depth-field mt-3 w-full px-2 py-1"
              placeholder="Buscar entregador pelo nome"
              value={courierQuery}
              onChange={(event) => setCourierQuery(event.target.value)}
            />
          </section>
          {visibleCouriers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum entregador com esse nome.</p>
          ) : (
            <ol className="depth-well space-y-3">
              {visibleCouriers.map((motoboy) => (
                <li key={motoboy.id} className="depth-card p-3">
                  <p className="font-medium">
                    {motoboys.indexOf(motoboy) + 1}. {motoboy.name}
                    {motoboy.active ? "" : " · Inativo"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        setError(null);
                        startTransition(async () => {
                          const result = await setMotoboyActiveAction(motoboy.id, !motoboy.active);
                          if (!result.ok) {
                            setError(result.error);
                            return;
                          }
                          router.refresh();
                        });
                      }}
                    >
                      {motoboy.active ? "Inativar" : "Reativar"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        setError(null);
                        startTransition(async () => {
                          const result = await deleteMotoboyAction(motoboy.id);
                          if (!result.ok) {
                            setError(result.error);
                            return;
                          }
                          router.refresh();
                        });
                      }}
                    >
                      Excluir
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <section className="depth-card p-4">
            <h2 className="font-medium">Novo entregador</h2>
            <div className="mt-3 flex gap-2">
              <input className="depth-field flex-1 px-2 py-1" placeholder="Nome" value={motoboyName} onChange={(event) => setMotoboyName(event.target.value)} />
              <Button
                disabled={pending || !motoboyName.trim()}
                onClick={() => {
                  setError(null);
                  startTransition(async () => {
                    const result = await createMotoboyAction(motoboyName);
                    if (!result.ok) {
                      setError(result.error);
                      return;
                    }
                    setMotoboyName("");
                    router.refresh();
                  });
                }}
              >
                Salvar entregador
              </Button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function ClientContactCard({ dentist, index }: { dentist: Dentist; index: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState(dentist.address);
  const [phone, setPhone] = useState(dentist.phone ?? "");

  return (
    <li className="depth-card p-3">
      <p className="font-medium">{index}. {dentist.name}{dentist.clinicName ? ` · ${dentist.clinicName}` : ""}</p>
      {dentist.routeNote ? <p className="text-sm text-muted-foreground">{dentist.routeNote}</p> : null}
      <div className="mt-2 grid gap-2">
        <input className="depth-field px-2 py-1 text-sm" placeholder="Endereço" value={address} onChange={(event) => setAddress(event.target.value)} />
        <input className="depth-field px-2 py-1 text-sm" placeholder="Telefone" value={phone} onChange={(event) => setPhone(event.target.value)} />
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await updateClientContactAction({ id: dentist.id, address, phone });
              if (!result.ok) {
                setError(result.error);
                return;
              }
              router.refresh();
            });
          }}
        >
          Salvar endereço e telefone
        </Button>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </li>
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
