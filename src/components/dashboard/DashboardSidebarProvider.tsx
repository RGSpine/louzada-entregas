"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DASHBOARD_SIDEBAR_PINNED_KEY,
  readDashboardSidebarPinned,
  writeDashboardSidebarPinned,
} from "@/lib/dashboard-sidebar-preference";

type DashboardSidebarContextValue = {
  mounted: boolean;
  /** Menu lateral sempre visível no layout (docked). */
  pinned: boolean;
  /** Painel aberto quando não está fixo (overlay). */
  overlayOpen: boolean;
  /** Sidebar deve renderizar agora. */
  isVisible: boolean;
  setPinned: (pinned: boolean) => void;
  openOverlay: () => void;
  closeOverlay: () => void;
};

const DashboardSidebarContext = createContext<DashboardSidebarContextValue | null>(null);

export function DashboardSidebarProvider({
  children,
  storageKey = DASHBOARD_SIDEBAR_PINNED_KEY,
}: {
  children: ReactNode;
  storageKey?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [pinned, setPinnedState] = useState(true);
  const [overlayOpen, setOverlayOpen] = useState(false);

  useEffect(() => {
    // Lê preferência após o paint — evita setState síncrono no primeiro commit.
    const id = window.setTimeout(() => {
      setPinnedState(readDashboardSidebarPinned(storageKey));
      setMounted(true);
    }, 0);
    return () => window.clearTimeout(id);
  }, [storageKey]);

  const setPinned = useCallback((next: boolean) => {
    setPinnedState(next);
    writeDashboardSidebarPinned(next, storageKey);
    if (next) setOverlayOpen(false);
  }, [storageKey]);

  const openOverlay = useCallback(() => setOverlayOpen(true), []);
  const closeOverlay = useCallback(() => setOverlayOpen(false), []);

  const isVisible = pinned || overlayOpen;

  const value = useMemo(
    () => ({
      mounted,
      pinned,
      overlayOpen,
      isVisible,
      setPinned,
      openOverlay,
      closeOverlay,
    }),
    [mounted, pinned, overlayOpen, isVisible, setPinned, openOverlay, closeOverlay],
  );

  return (
    <DashboardSidebarContext.Provider value={value}>{children}</DashboardSidebarContext.Provider>
  );
}

export function useDashboardSidebar() {
  const ctx = useContext(DashboardSidebarContext);
  if (!ctx) {
    throw new Error("useDashboardSidebar must be used within DashboardSidebarProvider");
  }
  return ctx;
}
