"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, UsersRound } from "lucide-react";
import { toast } from "sonner";
import {
  requestAdminPinReset,
  switchActiveIntraUser,
} from "@/app/actions/intra-users";
import type { ActiveIntraUser } from "@/lib/intra-user/patient-scope";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Tela de seleção de perfil (estilo "quem está usando") exibida após o login em
 * contas de clínica com múltiplos Intra Users, quando nenhum perfil está ativo.
 * Opção B: MEMBER entra livre; ADMIN exige PIN (ou setup inicial).
 */
export function IntraUserProfileGate({ profiles }: { profiles: ActiveIntraUser[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pinTarget, setPinTarget] = useState<ActiveIntraUser | null>(null);
  const [pin, setPin] = useState("");
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");

  function resetPinUi() {
    setPinTarget(null);
    setPin("");
    setForgotOpen(false);
    setForgotEmail("");
    setPendingId(null);
  }

  async function pick(profile: ActiveIntraUser) {
    if (profile.isOwner) {
      setPinTarget(profile);
      setPin("");
      setForgotOpen(false);
      setForgotEmail("");
      return;
    }

    setPendingId(profile.id);
    try {
      const res = await switchActiveIntraUser(profile.id);
      if (!res.success) {
        toast.error(res.error);
        setPendingId(null);
        return;
      }
      router.refresh();
    } catch {
      toast.error("Não foi possível selecionar o perfil.");
      setPendingId(null);
    }
  }

  async function submitPin(e: React.FormEvent) {
    e.preventDefault();
    if (!pinTarget) return;
    if (!/^\d{4}$/.test(pin)) {
      toast.error("O PIN tem 4 números.");
      return;
    }
    setPendingId(pinTarget.id);
    try {
      const res = await switchActiveIntraUser(pinTarget.id, pin);
      if (!res.success) {
        toast.error(res.error);
        setPendingId(null);
        return;
      }
      router.refresh();
    } catch {
      toast.error("Não foi possível validar o PIN.");
      setPendingId(null);
    }
  }

  async function sendPinReset(event: React.FormEvent) {
    event.preventDefault();
    setPendingId(pinTarget?.id ?? "reset");
    try {
      const result = await requestAdminPinReset(forgotEmail);
      if (!result.success) {
        toast.error(result.error);
        setPendingId(null);
        return;
      }
      toast.success("Enviamos o link de troca para o e-mail cadastrado.");
      setForgotOpen(false);
      setPendingId(null);
    } catch {
      toast.error("Não foi possível enviar o e-mail.");
      setPendingId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-background/95 px-4 backdrop-blur">
      <div className="w-full max-w-lg text-center">
        <div className="mb-8 space-y-2">
          <UsersRound className="mx-auto h-10 w-10 text-primary" aria-hidden />
          <h1 className="text-2xl font-bold text-foreground">Quem está operando?</h1>
          <p className="text-muted-foreground">
            Escolha o seu nome. O administrador principal informa o PIN de 4 números.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={pendingId !== null}
              onClick={() => pick(p)}
              className="group flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-5 transition hover:border-primary hover:shadow-md disabled:opacity-60"
            >
              <span
                className="relative flex h-16 w-16 items-center justify-center rounded-full text-xl font-bold text-white shadow-sm"
                style={{ backgroundColor: p.color }}
              >
                {pendingId === p.id ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : (
                  p.name.trim().charAt(0).toUpperCase()
                )}
                {p.isOwner && (
                  <Lock
                    className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-background p-0.5 text-foreground"
                    aria-label="Requer PIN"
                  />
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">{p.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {p.role === "ADMIN" ? "Administrador" : "Membro"}
                </span>
              </span>
            </button>
          ))}
        </div>

        {pinTarget && (
          <form
            onSubmit={submitPin}
            className="mt-8 space-y-3 rounded-2xl border border-border bg-card p-5 text-left shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-foreground">
                  PIN de administrador — {pinTarget.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  Digite os 4 números para entrar como administrador.
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={resetPinUi}>
                Cancelar
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-pin">PIN</Label>
              <Input
                id="admin-pin"
                type="password"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                className="bg-background border-border tracking-widest"
                autoFocus
              />
            </div>
            <Button type="submit" className="w-full" disabled={pendingId !== null || pin.length !== 4}>
              {pendingId ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Lock className="mr-2 h-4 w-4" />
              )}
              Entrar
            </Button>
          </form>
        )}
        {pinTarget ? (
          <div className="mt-3 space-y-2 text-left">
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => setForgotOpen((open) => !open)}
            >
              Esqueci o PIN
            </Button>
            {forgotOpen ? (
              <form onSubmit={sendPinReset} className="space-y-2 rounded-2xl border border-border bg-card p-5">
                <Label htmlFor="pin-reset-email">E-mail cadastrado na conta</Label>
                <Input
                  id="pin-reset-email"
                  type="email"
                  autoComplete="email"
                  value={forgotEmail}
                  onChange={(event) => setForgotEmail(event.target.value)}
                  placeholder="E-mail da conta"
                />
                <Button type="submit" variant="outline" className="w-full" disabled={pendingId !== null}>
                  Enviar link de troca
                </Button>
              </form>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
