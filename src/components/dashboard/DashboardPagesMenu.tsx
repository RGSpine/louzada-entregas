"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Menu,
  LogOut,
  Loader2,
  LayoutDashboard,
  Mic,
  Users,
  CalendarDays,
  FileStack,
  Activity,
  User,
  MessageSquareText,
  Bot,
  Sparkles,
  Lightbulb,
  Wallet,
  Zap,
  Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/app/actions/auth";
import { releaseAccessSessionClient } from "@/lib/access-session-client";
import { toast } from "sonner";
import {
  DASHBOARD_HOME_TITLE,
  isDashboardNavPageActive,
  type DashboardNavIcon,
  type DashboardNavPageDef,
} from "@/lib/dashboard-nav-pages";
import { useDashboardNavPages } from "@/hooks/use-dashboard-nav-pages";
import { cn } from "@/lib/utils";

const NAV_ICONS: Record<
  DashboardNavIcon,
  ComponentType<{ className?: string; "aria-hidden"?: boolean }>
> = {
  layoutDashboard: LayoutDashboard,
  mic: Mic,
  users: Users,
  calendar: CalendarDays,
  wallet: Wallet,
  fileStack: FileStack,
  activity: Activity,
  user: User,
  message: MessageSquareText,
  bot: Bot,
  sparkles: Sparkles,
  lightbulb: Lightbulb,
  zap: Zap,
  link: Link2,
};

export function DashboardPagesMenu() {
  const pathname = usePathname();
  const router = useRouter();
  const navPages = useDashboardNavPages();
  const [open, setOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await releaseAccessSessionClient();
      const result = await logoutAction();
      if (result.success) {
        close();
        toast.success("Logout realizado com sucesso!");
        router.push("/login");
      } else {
        toast.error(result.error || "Erro ao fazer logout");
      }
    } catch {
      toast.error("Erro inesperado ao fazer logout");
    } finally {
      setIsLoggingOut(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) close();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
    };
  }, [open, close]);

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={cn(
          "h-9 w-9 shrink-0 rounded-lg border-border bg-card text-foreground shadow-sm hover:bg-muted",
          open && "ring-2 ring-primary/60 ring-offset-2 ring-offset-background dark:ring-offset-background"
        )}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="dashboard-pages-menu-panel"
        aria-label={open ? `Fechar menu de páginas do ${DASHBOARD_HOME_TITLE}` : `Abrir menu de páginas do ${DASHBOARD_HOME_TITLE}`}
        onClick={() => setOpen((v) => !v)}
      >
        <Menu className="h-5 w-5" strokeWidth={2} aria-hidden />
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-background/20 backdrop-blur-[1px] dark:bg-black/40" aria-hidden />
          <div
            id="dashboard-pages-menu-panel"
            role="dialog"
            aria-modal="true"
            aria-label={`Páginas do ${DASHBOARD_HOME_TITLE}`}
            className={cn(
              "z-50 flex min-h-0 max-h-[min(80dvh,32rem)] flex-col rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-elevation-3)]",
              /* Mobile: painel com margens iguais (centrado na viewport, texto visível) */
              "fixed inset-x-3 top-[calc(4.5rem+env(safe-area-inset-top,0px))] w-auto sm:inset-x-4",
              /* md+: sob o botão hambúrguer, alinhado à esquerda */
              "md:absolute md:inset-x-auto md:left-0 md:top-full md:mt-2 md:max-h-[min(70vh,28rem)] md:w-[min(calc(100vw-2rem),36rem)]"
            )}
          >
            <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Ir para
            </p>
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-0.5 pr-0.5">
              {navPages.map((page: DashboardNavPageDef) => {
                const Icon = NAV_ICONS[page.icon];
                const active = isDashboardNavPageActive(pathname, page);
                return (
                  <li key={page.href}>
                    <Link
                      href={page.href}
                      prefetch={false}
                      onClick={close}
                      className={cn(
                        "flex gap-3 rounded-lg border border-transparent p-3 transition-colors",
                        "hover:border-primary/35 hover:bg-muted dark:hover:border-primary/30 dark:hover:bg-muted/80",
                        active &&
                          "border-primary/40 bg-primary/100/5 ring-1 ring-primary/25 dark:border-primary/35 dark:bg-primary/10"
                      )}
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block font-semibold text-foreground">{page.title}</span>
                        <span className="mt-0.5 block text-sm leading-snug text-muted-foreground break-words dark:text-muted-foreground">
                          {page.description}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="mt-2 border-t border-border pt-2 dark:border-border">
              <Button
                type="button"
                variant="outline"
                disabled={isLoggingOut}
                className="h-auto w-full justify-start gap-3 rounded-lg border-destructive/40 py-3 text-left text-destructive hover:bg-destructive/10 hover:text-destructive dark:border-destructive/35 dark:text-destructive dark:hover:bg-destructive/15 dark:hover:text-destructive"
                onClick={() => void handleLogout()}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
                  {isLoggingOut ? (
                    <Loader2 className="h-5 w-5 animate-spin text-destructive dark:text-destructive" aria-hidden />
                  ) : (
                    <LogOut className="h-5 w-5 text-destructive dark:text-destructive" aria-hidden />
                  )}
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block font-semibold">Sair</span>
                  <span className="mt-0.5 block text-sm font-normal text-muted-foreground">
                    Encerrar sessão na plataforma
                  </span>
                </span>
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
