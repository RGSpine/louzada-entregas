"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  DASHBOARD_HOME_TITLE,
  isDashboardNavPageActive,
  type DashboardNavIcon,
  type DashboardNavPageDef,
} from "@/lib/dashboard-nav-pages";
import { useDashboardNavPages } from "@/hooks/use-dashboard-nav-pages";
import {
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
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { menuItemVariants, menuStaggerVariants, clinicalPanelTransition } from "@/design/motion-presets";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { Button } from "@/components/ui/button";
import type { ComponentType } from "react";
import {
  ActiveIntraUserBadge,
  type DashboardIntraChromeProps,
} from "@/components/dashboard/team/ActiveIntraUserBadge";
import { LouzadaMark } from "@/components/brand/LouzadaLogo";

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

type Props = {
  variant?: "docked" | "overlay";
  onClose?: () => void;
  intra?: DashboardIntraChromeProps;
};

/** Sidebar desktop (≥1024px) — grouped list estilo HIG */
export function DashboardDesktopSidebar({
  variant = "docked",
  onClose,
  intra,
}: Props) {
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const navPages = useDashboardNavPages();
  const isOverlay = variant === "overlay";

  const List = reduced ? "ul" : motion.ul;
  const Item = reduced ? "li" : motion.li;
  const listProps = reduced
    ? {}
    : { variants: menuStaggerVariants, initial: "hidden", animate: "show" };
  const itemProps = reduced ? {} : { variants: menuItemVariants };

  const aside = (
    <aside
      className={cn(
        "flex w-60 shrink-0 flex-col border-r border-border bg-card shadow-[var(--shadow-elevation-2)] xl:w-64",
        isOverlay
          ? "fixed inset-y-0 left-0 z-[70] shadow-[var(--shadow-elevation-3)] safe-area-pt"
          : "sticky top-0 hidden h-screen lg:flex safe-area-pt",
      )}
      aria-label={`Navegação principal do ${DASHBOARD_HOME_TITLE}`}
    >
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-border px-4 py-4 xl:px-5 xl:py-5">
        <Link
          href="/dashboard"
          className="inline-flex min-w-0 items-center gap-2.5"
          onClick={isOverlay ? onClose : undefined}
        >
          <LouzadaMark className="h-9 w-9 shrink-0 text-primary" />
          <span className="truncate text-lg font-semibold leading-tight tracking-tight text-primary">
            Louzada
          </span>
        </Link>
        {isOverlay && onClose ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Fechar menu lateral"
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        ) : null}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 [scrollbar-gutter:stable]">
        <List className="space-y-1" {...listProps}>
          {navPages.map((page: DashboardNavPageDef) => {
            const Icon = NAV_ICONS[page.icon];
            const active = isDashboardNavPageActive(pathname, page);
            return (
              <Item key={page.href} {...itemProps}>
                <Link
                  href={page.href}
                  onClick={isOverlay ? onClose : undefined}
                  className={cn(
                    "flex min-h-[2.75rem] items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                    active
                      ? "bg-primary/10 font-medium text-primary ring-1 ring-primary/20"
                      : "text-foreground hover:bg-muted",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="truncate">{page.title}</span>
                </Link>
              </Item>
            );
          })}
        </List>
      </nav>

      {intra?.isTeamPlan && intra.activeIntraUser ? (
        <div className="shrink-0 border-t border-border p-3">
          <p className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Atendendo como
          </p>
          <ActiveIntraUserBadge
            profile={intra.activeIntraUser}
            isTeamPlan={intra.isTeamPlan}
            canSwitch={intra.canSwitchIntraUser}
            className="w-full max-w-none justify-start"
          />
        </div>
      ) : null}
    </aside>
  );

  if (!isOverlay) return aside;

  if (reduced) return aside;

  return (
    <motion.div
      initial={{ x: "-100%" }}
      animate={{ x: 0 }}
      exit={{ x: "-100%" }}
      transition={clinicalPanelTransition}
      className="hidden lg:block"
    >
      {aside}
    </motion.div>
  );
}

type BackdropProps = {
  open: boolean;
  onClose: () => void;
};

export function DashboardSidebarOverlayBackdrop({ open, onClose }: BackdropProps) {
  const reduced = useReducedMotion();

  if (reduced) {
    if (!open) return null;
    return (
      <button
        type="button"
        className="fixed inset-0 z-[65] hidden bg-black/50 lg:block"
        onClick={onClose}
        aria-label="Fechar menu lateral"
      />
    );
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.button
          type="button"
          key="sidebar-backdrop"
          className="fixed inset-0 z-[65] hidden bg-black/50 backdrop-blur-[1px] lg:block"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={clinicalPanelTransition}
          onClick={onClose}
          aria-label="Fechar menu lateral"
        />
      ) : null}
    </AnimatePresence>
  );
}
