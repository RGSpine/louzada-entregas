/**
 * Após login (Server Action ou API), confirma que os cookies httpOnly
 * já estão visíveis no browser — crítico no Safari iOS.
 */

export async function waitForAuthSession(options?: {
  maxAttempts?: number;
  baseDelayMs?: number;
}): Promise<boolean> {
  const maxAttempts = options?.maxAttempts ?? 8;
  const baseDelayMs = options?.baseDelayMs ?? 150;

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
        if (body?.ok !== false) return true;
      }
    } catch {
      // tenta de novo
    }
    await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1)));
  }
  return false;
}

/** Navegação full-page estável no iOS (replace + fallback). */
export function hardNavigate(url: string): void {
  try {
    window.location.replace(url);
  } catch {
    window.location.href = url;
  }
  window.setTimeout(() => {
    if (typeof window !== "undefined" && !window.location.href.includes(url.split("?")[0]!)) {
      window.location.href = url;
    }
  }, 1200);
}
