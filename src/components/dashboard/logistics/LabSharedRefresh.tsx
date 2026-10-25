"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const INTERVAL_MS = 12_000;

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
    const tick = () => {
      if (isBusy()) return;
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
