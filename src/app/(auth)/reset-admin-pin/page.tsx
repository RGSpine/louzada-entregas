"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { confirmAdminPinReset } from "@/app/actions/intra-users";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function ResetAdminPinForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      const result = await confirmAdminPinReset({ token, pin, confirmPin });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setDone(true);
    } catch {
      toast.error("Não foi possível trocar o PIN.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-4">
      <div className="w-full space-y-4 rounded-2xl border border-border bg-card p-6">
        <h1 className="text-2xl font-bold text-foreground">Trocar o PIN do administrador</h1>
        {done ? (
          <>
            <p className="text-sm text-muted-foreground">
              O PIN novo já vale. Volte e escolha o administrador para entrar.
            </p>
            <Button asChild className="w-full">
              <Link href="/dashboard">Voltar ao laboratório</Link>
            </Button>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-admin-pin">Novo PIN</Label>
              <Input
                id="new-admin-pin"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={4}
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-admin-pin">Confirmar PIN</Label>
              <Input
                id="confirm-admin-pin"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={4}
                value={confirmPin}
                onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
              />
            </div>
            <Button type="submit" className="w-full" disabled={pending || pin.length !== 4 || confirmPin.length !== 4}>
              {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Salvar PIN
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ResetAdminPinPage() {
  return (
    <Suspense fallback={null}>
      <ResetAdminPinForm />
    </Suspense>
  );
}
