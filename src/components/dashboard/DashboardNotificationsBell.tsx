"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bell, CalendarDays, CheckCheck, ListChecks, Loader2, Settings, Share2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  getDashboardNotifications,
  markDashboardNotificationsAsRead,
} from "@/app/actions/dashboard-notifications";
import type { DashboardNotificationItem } from "@/lib/dashboard-notifications";

function kindIcon(kind: DashboardNotificationItem["kind"]) {
  switch (kind) {
    case "appointment":
      return CalendarDays;
    case "action_item":
      return ListChecks;
    case "package_ending":
      return Wallet;
    case "monthly_mid_period":
      return Wallet;
    case "health_share":
      return Share2;
    default:
      return Settings;
  }
}

/**
 * Sino unificado no chrome do dashboard (Menu Principal, Pacientes, Nova Evolução, Ester, Agenda, …).
 */
export function DashboardNotificationsBell() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);
  const [items, setItems] = useState<DashboardNotificationItem[]>([]);
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getDashboardNotifications();
      if ("error" in res) {
        setItems([]);
        setCount(0);
        return;
      }
      setItems(res.items);
      setCount(res.count);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void load();
    }, 2000);
    return () => window.clearTimeout(id);
  }, [load, pathname]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  const handleMarkAllRead = async () => {
    if (markingRead || items.length === 0) return;
    setMarkingRead(true);
    try {
      const ids = items.map((i) => i.id);
      const res = await markDashboardNotificationsAsRead({ ids });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      setItems([]);
      setCount(0);
      toast.success(
        res.cleared > 0
          ? "Todas as notificações foram marcadas como lidas."
          : "Nada novo para marcar como lido.",
      );
      setOpen(false);
    } finally {
      setMarkingRead(false);
    }
  };

  const handleItemClick = async (item: DashboardNotificationItem) => {
    setOpen(false);
    // Marca só este item como lido (não bloqueia a navegação).
    void markDashboardNotificationsAsRead({ ids: [item.id] }).then((res) => {
      if (!res.success) return;
      setItems((prev) => {
        const next = prev.filter((i) => i.id !== item.id);
        return next;
      });
      setCount((c) =>
        item.kind === "system" ? c : Math.max(0, c - 1),
      );
    });
    router.push(item.href);
  };

  const badge = count > 9 ? "9+" : count > 0 ? String(count) : null;

  return (
    <div className={cn("relative", open && "z-[130]")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "relative flex h-9 min-w-9 min-touch items-center justify-center rounded-lg border border-border bg-card px-2",
          "shadow-[var(--shadow-elevation-1)] transition-[box-shadow,transform] hover:shadow-[var(--shadow-elevation-2)]",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "active:scale-[0.98]",
        )}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={
          count > 0
            ? `Notificações: ${count} pendente${count === 1 ? "" : "s"}`
            : "Notificações"
        }
        title="Notificações"
      >
        <Bell className="h-4 w-4 shrink-0 text-foreground" aria-hidden />
        {badge ? (
          <span
            className={cn(
              "absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full",
              "bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground",
            )}
          >
            {badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <div
            className="fixed inset-0 z-[110]"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label="Central de notificações"
            className={cn(
              "absolute right-0 top-full z-[120] mt-2 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl",
              "border border-border bg-popover shadow-[var(--shadow-elevation-3)]",
            )}
          >
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
              <p className="text-sm font-semibold text-foreground">Notificações</p>
              <button
                type="button"
                disabled={markingRead || items.length === 0}
                onClick={() => void handleMarkAllRead()}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium",
                  "text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                {markingRead ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <CheckCheck className="h-3.5 w-3.5" aria-hidden />
                )}
                Marcar como lido
              </button>
            </div>

            <div className="max-h-[min(24rem,70vh)] overflow-y-auto">
              {loading && items.length === 0 ? (
                <div className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Carregando…
                </div>
              ) : items.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Nenhuma notificação no momento.
                </p>
              ) : (
                <ul className="divide-y divide-border p-1">
                  {items.map((item) => {
                    const Icon = kindIcon(item.kind);
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => void handleItemClick(item)}
                          className={cn(
                            "flex w-full min-h-[2.75rem] gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors",
                            "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          )}
                        >
                          <span
                            className={cn(
                              "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border",
                              item.priority === "high"
                                ? "bg-warning/15 text-warning"
                                : item.kind === "appointment"
                                  ? "bg-primary/10 text-primary"
                                  : item.kind === "action_item"
                                    ? "bg-clinical/15 text-clinical"
                                    : item.kind === "package_ending" ||
                                        item.kind === "monthly_mid_period"
                                      ? "bg-warning/10 text-warning"
                                      : "bg-muted text-muted-foreground",
                            )}
                          >
                            <Icon className="h-4 w-4" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium leading-snug text-foreground">
                              {item.title}
                            </span>
                            <span className="mt-0.5 block text-xs leading-snug text-muted-foreground line-clamp-2">
                              {item.body}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
