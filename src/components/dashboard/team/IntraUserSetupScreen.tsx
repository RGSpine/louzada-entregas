"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UsersRound } from "lucide-react";
import { toast } from "sonner";

import { completeTeamSetup } from "@/app/actions/intra-users";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MAX_PEOPLE = 10;

export function IntraUserSetupScreen() {
  const router = useRouter();
  const [names, setNames] = useState(["", "", ""]);
  const [adminIndex, setAdminIndex] = useState<number | null>(null);
  const [pending, setPending] = useState(false);

  function updateName(index: number, value: string) {
    setNames((current) => current.map((name, item) => (item === index ? value : name)));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const filled = names
      .map((name, index) => ({ name: name.trim(), index }))
      .filter((item) => item.name.length > 0);
    if (filled.length === 0) {
      toast.error("Informe pelo menos um nome.");
      return;
    }
    if (adminIndex == null || !filled.some((item) => item.index === adminIndex)) {
      toast.error("Marque qual pessoa é o administrador principal.");
      return;
    }
    const people = filled.map((item) => item.name);
    const nextAdminIndex = filled.findIndex((item) => item.index === adminIndex);
    setPending(true);
    try {
      const result = await completeTeamSetup({ people, adminIndex: nextAdminIndex });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    } catch {
      toast.error("Não foi possível salvar a equipe.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-10">
      <div className="mb-6 space-y-2 text-center">
        <UsersRound className="mx-auto h-10 w-10 text-primary" aria-hidden />
        <h1 className="text-2xl font-bold text-foreground">Quem opera o laboratório?</h1>
        <p className="text-sm text-muted-foreground">
          Este cadastro aparece uma vez. Dá para incluir até {MAX_PEOPLE} pessoas.
          Marque o administrador principal. Os demais entram em Meu Perfil, se precisar.
        </p>
      </div>
      <form onSubmit={submit} className="space-y-3 rounded-2xl border border-border bg-card p-5">
        {names.map((name, index) => (
          <div key={index} className="flex items-center gap-3">
            <input
              type="radio"
              name="lab-admin"
              className="h-4 w-4 shrink-0"
              checked={adminIndex === index}
              onChange={() => setAdminIndex(index)}
              aria-label={`Administrador principal: pessoa ${index + 1}`}
            />
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor={`lab-person-${index}`} className="sr-only">
                Nome {index + 1}
              </Label>
              <Input
                id={`lab-person-${index}`}
                value={name}
                maxLength={80}
                placeholder={index === 0 ? "Nome do administrador" : "Nome"}
                onChange={(event) => updateName(index, event.target.value)}
              />
            </div>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          O ponto ao lado do nome marca o administrador principal. Esse nome pode ser ajustado uma vez, em Meu Perfil.
        </p>
        <div className="flex flex-wrap gap-2">
          {names.length < MAX_PEOPLE ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setNames((current) => [...current, ""])}
            >
              Acrescentar pessoa
            </Button>
          ) : null}
          {names.length > 1 ? (
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setNames((current) => current.slice(0, -1));
                setAdminIndex((current) => (current != null && current >= names.length - 1 ? null : current));
              }}
            >
              Tirar a última
            </Button>
          ) : null}
        </div>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Salvar equipe
        </Button>
      </form>
    </div>
  );
}
