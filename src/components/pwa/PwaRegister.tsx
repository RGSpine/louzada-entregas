"use client";

import { useEffect } from "react";

/**
 * Registra o service worker em produção (online-first, sem cache de API).
 */
export function PwaRegister() {
  useEffect(() => {
    const allowDev =
      process.env.NODE_ENV === "production" ||
      process.env.NEXT_PUBLIC_ENABLE_PWA_INSTALL_DEV === "1";
    if (!allowDev) return;
    if (!("serviceWorker" in navigator)) return;

    const register = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      } catch (err) {
        console.warn("[PWA] Falha ao registrar service worker:", err);
      }
    };

    if (document.readyState === "complete") {
      void register();
    } else {
      window.addEventListener("load", () => void register(), { once: true });
    }
  }, []);

  return null;
}
