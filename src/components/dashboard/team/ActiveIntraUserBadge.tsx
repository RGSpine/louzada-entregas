"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Lock, RefreshCw, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { clearActiveIntraUserSession } from "@/app/actions/intra-users";
import { cn } from "@/lib/utils";

export type ActiveIntraUserBadgeProfile = {
  id: string;
  name: string;
  color: string;
  role: "ADMIN" | "MEMBER";
};

export type DashboardIntraChromeProps = {
  activeIntraUser: ActiveIntraUserBadgeProfile | null;
  isTeamPlan: boolean;
  canSwitchIntraUser: boolean;
};

type Props = {
  profile: ActiveIntraUserBadgeProfile | null;
  /** Plano Consultório/Clínica com 2+ perfis — permite trocar. */
  canSwitch: boolean;
  /** Conta de equipe (mostra chip mesmo com 1 perfil). */
  isTeamPlan: boolean;
  className?: string;
  /** Variante compacta no header. */
  compact?: boolean;
};

/**
 * Chip persistente do Intra User ativo — fecha o gap de “quem está usando”.
 * Em equipe com 2+ perfis, clicar limpa o cookie e reabre a tela de seleção (PIN no ADMIN).
 */
export function ActiveIntraUserBadge({
  profile,
  canSwitch,
  isTeamPlan,
  className,
  compact = false,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  if (!isTeamPlan || !profile) return null;

  const roleLabel = profile.role === "ADMIN" ? "Admin" : "Membro";
  const initial = profile.name.trim().charAt(0).toUpperCase() || "?";

  async function handleSwitch() {
    if (!canSwitch || busy || pending) return;
    setBusy(true);
    try {
      const res = await clearActiveIntraUserSession();
      if (!res.success) {
        toast.error(res.error ?? "Não foi possível trocar de perfil.");
        return;
      }
      startTransition(() => {
        router.refresh();
      });
    } finally {
      setBusy(false);
    }
  }

  const content = (
    <>
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full text-white shadow-sm",
          compact ? "h-6 w-6 text-[10px] font-bold" : "h-7 w-7 text-xs font-bold",
        )}
        style={{ backgroundColor: profile.color }}
        aria-hidden
      >
        {initial}
      </span>
      <span className="min-w-0 text-left">
        <span className={cn("block truncate font-medium text-foreground", compact ? "text-xs" : "text-sm")}>
          {profile.name}
        </span>
        {!compact && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            {profile.role === "ADMIN" ? <Lock className="h-3 w-3" aria-hidden /> : null}
            {roleLabel}
            {canSwitch ? " · trocar" : null}
          </span>
        )}
      </span>
      {canSwitch ? (
        <RefreshCw
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground",
            (busy || pending) && "animate-spin",
          )}
          aria-hidden
        />
      ) : (
        <UsersRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      )}
    </>
  );

  if (canSwitch) {
    return (
      <button
        type="button"
        onClick={() => void handleSwitch()}
        disabled={busy || pending}
        title="Trocar perfil profissional"
        aria-label={`Perfil ativo: ${profile.name}. Clique para trocar.`}
        className={cn(
          "inline-flex max-w-[14rem] items-center gap-2 rounded-full border border-border bg-card px-2.5 py-1.5 shadow-sm transition",
          "hover:border-primary/50 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          "disabled:opacity-60",
          className,
        )}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={cn(
        "inline-flex max-w-[14rem] items-center gap-2 rounded-full border border-border bg-card px-2.5 py-1.5 shadow-sm",
        className,
      )}
      title={`Perfil ativo: ${profile.name}`}
      aria-label={`Perfil ativo: ${profile.name}`}
    >
      {content}
    </div>
  );
}
