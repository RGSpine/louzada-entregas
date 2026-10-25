"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const INTERVAL_MS = 60_000;
const MIN_GAP_MS = 45_000;

function isBusy(): boolean {
  if (document.visibilityState !== "visible") return true;
  const el = document.activeElement;
  if (!el || el === document.body) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el instanceof HTMLElement && el.isContentEditable;
}

/** Atualiza painel, agenda, cadastro e caixa para quem está no outro aparelho. */
export function LabSharedRefresh() {
  const router = useRouter();

  useEffect(() => {
    let last = 0;
    const tick = () => {
      if (isBusy()) return;
      const now = Date.now();
      if (now - last < MIN_GAP_MS) return;
      last = now;
      router.refresh();
    };
    const id = window.setInterval(tick, INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return null;
}
