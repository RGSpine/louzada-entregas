"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { UsersRound } from "lucide-react";
import { listIntraUsers } from "@/app/actions/intra-users";
import { Button } from "@/components/ui/button";

/**
 * Conta Consultório/Clínica ainda só com o titular: orienta a definir a equipe
 * antes que a tela «Quem está atendendo?» passe a ser exigida (2+ perfis).
 */
export function TeamSetupNudge() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await listIntraUsers();
      if (cancelled || !res.success || !res.data) return;
      const { isClinica, intraUserCount, canManage } = res.data;
      if (isClinica && canManage && intraUserCount <= 1) {
        setShow(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!show) return null;

  return (
    <div className="mb-6 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 sm:px-5 sm:py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <UsersRound className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Configure a equipe do laboratório</p>
            <p className="text-xs leading-snug text-muted-foreground sm:text-sm">
              Cadastre quem opera o laboratório em Meu Perfil. Enquanto houver só o
              titular, você entra direto; com 2 ou mais, o login pedirá quem está operando.
            </p>
          </div>
        </div>
        <Button asChild size="sm" className="shrink-0">
          <Link href="/dashboard/profile#equipe-clinica">Definir equipe</Link>
        </Button>
      </div>
    </div>
  );
}
