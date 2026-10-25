"use client";

import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence } from "motion/react";
import { BackNavButton, BackNavLink } from "@/components/navigation/BackNav";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { DashboardPagesMenu } from "@/components/dashboard/DashboardPagesMenu";
import { DashboardNotificationsBell } from "@/components/dashboard/DashboardNotificationsBell";
import {
  DashboardDesktopSidebar,
  DashboardSidebarOverlayBackdrop,
} from "@/components/dashboard/DashboardDesktopSidebar";
import { DashboardSidebarProvider, useDashboardSidebar } from "@/components/dashboard/DashboardSidebarProvider";
import { DashboardSidebarToggle } from "@/components/dashboard/DashboardSidebarToggle";
import {
  getDashboardNavPageTitle,
  getDashboardBackTarget,
  DASHBOARD_HOME_LINK_LABELS,
  isEsterClinicalChatPath,
} from "@/lib/dashboard-nav-pages";
import { EsterFeatureTitle } from "@/components/dashboard/clinical-chat/EsterFeatureTitle";
import { AccessSessionGuard } from "@/components/auth/AccessSessionGuard";
import {
  ActiveIntraUserBadge,
  type DashboardIntraChromeProps,
} from "@/components/dashboard/team/ActiveIntraUserBadge";

function isDashboardRoot(pathname: string | null): boolean {
  if (!pathname) return false;
  return pathname === "/dashboard" || pathname === "/dashboard/";
}

export type { DashboardIntraChromeProps };

function DashboardChromeToolbar({
  className,
  intra,
  /** Inclui o toggle da sidebar (desktop). No mobile o menu fica à esquerda. */
  showDesktopSidebarToggle = true,
}: {
  className?: string;
  intra: DashboardIntraChromeProps;
  showDesktopSidebarToggle?: boolean;
}) {
  return (
    <div className={className}>
      <ActiveIntraUserBadge
        profile={intra.activeIntraUser}
        isTeamPlan={intra.isTeamPlan}
        canSwitch={intra.canSwitchIntraUser}
        compact
      />
      <DashboardNotificationsBell />
      {showDesktopSidebarToggle ? (
        <DashboardSidebarToggle className="hidden lg:inline-flex" />
      ) : null}
      <ThemeToggle />
    </div>
  );
}

function DashboardShell({
  children,
  intra,
}: {
  children: React.ReactNode;
  intra: DashboardIntraChromeProps;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { mounted, pinned, overlayOpen, closeOverlay } = useDashboardSidebar();
  const isRoot = isDashboardRoot(pathname);
  const backTarget = getDashboardBackTarget(pathname ?? "");

  const handleBack = () => {
    if (backTarget) {
      router.push(backTarget.href);
      return;
    }
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/dashboard");
    }
  };

  const showDockedSidebar = !mounted || pinned;
  const showOverlaySidebar = mounted && !pinned && overlayOpen;

  return (
    <AccessSessionGuard>
      <div className="depth-stage flex min-h-screen">
        {showDockedSidebar ? (
          <DashboardDesktopSidebar variant="docked" intra={intra} />
        ) : null}

        <DashboardSidebarOverlayBackdrop open={showOverlaySidebar} onClose={closeOverlay} />
        <AnimatePresence>
          {showOverlaySidebar ? (
            <DashboardDesktopSidebar
              key="overlay-sidebar"
              variant="overlay"
              onClose={closeOverlay}
              intra={intra}
            />
          ) : null}
        </AnimatePresence>

        <div className="flex min-w-0 flex-1 flex-col">
          {isRoot ? (
            <div className="sticky top-0 z-[100] flex items-center gap-2 border-b border-border/60 bg-card/85 px-4 py-3 shadow-[var(--shadow-elevation-1)] backdrop-blur-md safe-area-pt">
              <DashboardSidebarToggle
                compact
                className="inline-flex shrink-0 lg:hidden"
              />
              <DashboardChromeToolbar
                className="ml-auto flex shrink-0 items-center gap-2"
                intra={intra}
              />
            </div>
          ) : (
            <header className="sticky top-0 z-50 border-b border-border bg-card/85 shadow-[var(--shadow-elevation-1)] backdrop-blur-md safe-area-pt">
              <div className="container mx-auto max-w-7xl px-4 py-3">
                <div className="flex w-full min-w-0 items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    {backTarget ? (
                      <BackNavLink
                        href={backTarget.href}
                        label="Voltar"
                        ariaLabel={backTarget.label}
                        className="shrink-0"
                      />
                    ) : (
                      <BackNavButton
                        onClick={handleBack}
                        ariaLabel={DASHBOARD_HOME_LINK_LABELS.voltarPara}
                        className="shrink-0"
                      />
                    )}
                    <DashboardPagesMenu />
                    {isEsterClinicalChatPath(pathname ?? "") ? (
                      <p className="hidden truncate text-lg font-bold text-foreground lg:block">
                        <EsterFeatureTitle
                          variant="chat"
                          nameClassName="text-lg"
                          subtitleClassName="text-sm"
                        />
                      </p>
                    ) : (
                      <p className="hidden truncate text-lg font-bold text-foreground lg:block">
                        {getDashboardNavPageTitle(pathname ?? "")}
                      </p>
                    )}
                  </div>
                  <DashboardChromeToolbar
                    className="flex shrink-0 items-center gap-2"
                    intra={intra}
                  />
                </div>
              </div>
            </header>
          )}

          {children}
        </div>
      </div>
    </AccessSessionGuard>
  );
}

export function DashboardSubnavChrome({
  children,
  activeIntraUser = null,
  isTeamPlan = false,
  canSwitchIntraUser = false,
}: {
  children: React.ReactNode;
} & Partial<DashboardIntraChromeProps>) {
  const intra: DashboardIntraChromeProps = {
    activeIntraUser,
    isTeamPlan,
    canSwitchIntraUser,
  };
  return (
    <DashboardSidebarProvider>
      <DashboardShell intra={intra}>{children}</DashboardShell>
    </DashboardSidebarProvider>
  );
}
