"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

const RATE_LIMIT_TOAST_ID = "aievolui-rate-limit-429";
const TOAST_COOLDOWN_MS = 4000;

/**
 * Intercepta `fetch` global para status 429 (Edge / API rate limit).
 * Mostra toast amigável sem quebrar a UI do PWA.
 */
export function RateLimitFetchGuard() {
  const lastToastAt = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const originalFetch = window.fetch.bind(window);

    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await originalFetch(...args);

      if (response.status === 429) {
        const now = Date.now();
        if (now - lastToastAt.current >= TOAST_COOLDOWN_MS) {
          lastToastAt.current = now;
          const retryAfter = response.headers.get("Retry-After");
          const seconds = retryAfter && /^\d+$/.test(retryAfter) ? retryAfter : null;
          toast.error(
            seconds
              ? `Calma aí! Detectamos muitos acessos. Tente novamente em ${seconds}s.`
              : "Calma aí! Detectamos muitos acessos. Tente novamente em alguns segundos.",
            { id: RATE_LIMIT_TOAST_ID, duration: 5000 },
          );
        }
      }

      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}
