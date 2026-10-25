"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { logoutAction } from "@/app/actions/auth";
import { refreshAuthSessionClient } from "@/lib/auth-exchange-client";
import { ACCESS_SESSION_HEARTBEAT_MS } from "@/lib/access-session-timing";
import { getOrCreateDeviceId } from "@/lib/device-id-client";

type Props = {
  children: React.ReactNode;
};

type AccessSessionErrorCode =
  | "ACCESS_LIMIT_EXCEEDED"
  | "ACCESS_SESSION_INVALID"
  | "CHECKOUT_REQUIRED";

/** Prisma local/WSL frequentemente >8s; timeout curto deixava o dashboard em spinner eterno. */
const ACCESS_SESSION_FETCH_MS = 30_000;
const FOREGROUND_DEBOUNCE_MS = 2_500;

async function parseAccessSessionError(
  res: Response,
): Promise<{
  message: string;
  errorCode?: AccessSessionErrorCode;
  redirectTo?: string;
}> {
  const data = await res.json().catch(() => ({}));
  return {
    message:
      typeof data?.error === "string"
        ? data.error
        : "Não foi possível validar o acesso deste dispositivo.",
    errorCode:
      data?.errorCode === "ACCESS_LIMIT_EXCEEDED" ||
      data?.errorCode === "ACCESS_SESSION_INVALID" ||
      data?.errorCode === "CHECKOUT_REQUIRED"
        ? data.errorCode
        : undefined,
    redirectTo:
      typeof data?.redirectTo === "string" ? data.redirectTo : undefined,
  };
}

async function fetchAccessSession(
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ACCESS_SESSION_FETCH_MS);
  try {
    return await fetch("/api/access-session", {
      method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export function AccessSessionGuard({ children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const onPlanos =
    pathname === "/dashboard/planos" || pathname?.startsWith("/dashboard/planos/");
  const [ready, setReady] = useState(onPlanos);
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const lastForegroundAtRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    async function signOutAndRedirect(message: string) {
      toast.error(message, { duration: 8000 });
      try {
        await logoutAction();
      } catch {
        // ignore
      }
      router.replace(`/login?reason=access_limit`);
    }

    async function registerSession(): Promise<boolean> {
      const deviceId = getOrCreateDeviceId();
      if (!deviceId) return onPlanos;

      // Sempre claim no boot: em plano individual o último aparelho que entra vence.
      const claim = true;
      let res: Response;
      try {
        res = await fetchAccessSession("POST", {
          deviceId,
          platform: "web",
          claim,
        });
      } catch {
        // 1ª falha de rede: tenta mais uma vez antes de degradar.
        try {
          res = await fetchAccessSession("POST", {
            deviceId,
            platform: "web",
            claim,
          });
        } catch {
          if (onPlanos) return true;
          console.warn(
            "[AccessSessionGuard] Timeout/rede ao registrar sessão (2×) — liberando UI; heartbeat revalida.",
          );
          toast.warning(
            "Não foi possível validar o dispositivo agora. Tentaremos de novo em segundo plano.",
            { duration: 6000 },
          );
          return true;
        }
      }

      if (res.ok) return true;

      const { message, errorCode, redirectTo } = await parseAccessSessionError(res);
      if (onPlanos) {
        console.warn("[AccessSessionGuard] Sessão opcional em /planos:", message);
        return true;
      }

      if (res.status === 402 || errorCode === "CHECKOUT_REQUIRED") {
        router.replace(redirectTo ?? "/dashboard");
        return false;
      }

      if (res.status === 409 && errorCode === "ACCESS_LIMIT_EXCEEDED") {
        await signOutAndRedirect(message);
        return false;
      }

      if (res.status === 401) {
        router.replace("/login");
        return false;
      }

      // 429 / 5xx: retry único; se persistir, libera UI mas o heartbeat força re-claim.
      if (res.status === 429 || res.status >= 500) {
        try {
          const retry = await fetchAccessSession("POST", {
            deviceId,
            platform: "web",
            claim,
          });
          if (retry.ok) return true;
          const retryParsed = await parseAccessSessionError(retry);
          if (retry.status === 409 && retryParsed.errorCode === "ACCESS_LIMIT_EXCEEDED") {
            await signOutAndRedirect(retryParsed.message);
            return false;
          }
        } catch {
          /* segue para degradar */
        }
        console.warn("[AccessSessionGuard] Erro temporário ao registrar sessão:", message);
        toast.warning("Validação de acesso demorou — o menu foi liberado; tentaremos de novo.", {
          duration: 6000,
        });
        return true;
      }

      console.warn("[AccessSessionGuard] Falha ao registrar sessão:", message);
      toast.error(message, { duration: 8000 });
      router.replace("/login?reason=access_limit");
      return false;
    }

    async function heartbeat(): Promise<void> {
      if (onPlanos) return;
      const deviceId = getOrCreateDeviceId();
      if (!deviceId) return;

      let res: Response;
      try {
        res = await fetchAccessSession("PATCH", { deviceId });
      } catch {
        return;
      }

      if (res.ok) return;

      if (res.status === 401) {
        await refreshAuthSessionClient();
        try {
          const retry = await fetchAccessSession("PATCH", { deviceId });
          if (retry.ok) return;
        } catch {
          return;
        }
      }

      const { message, errorCode } = await parseAccessSessionError(res);
      if (res.status === 409 && errorCode === "ACCESS_LIMIT_EXCEEDED") {
        await signOutAndRedirect(
          message ||
            "Sua sessão foi encerrada porque outro dispositivo assumiu o acesso desta conta.",
        );
        return;
      }
      // Sessão nunca claimou (fail-open) ou expirou: tenta POST de novo.
      if (res.status === 409 && errorCode === "ACCESS_SESSION_INVALID") {
        const ok = await registerSession();
        if (!ok) return;
      }
    }

    // Em /planos: UI imediata + claim leve (sem refresh em loop no focus).
    if (onPlanos) {
      setReady(true);
      void registerSession();
      return () => {
        cancelled = true;
      };
    }

    async function onForeground(force = false): Promise<void> {
      if (cancelled) return;
      const now = Date.now();
      if (!force && now - lastForegroundAtRef.current < FOREGROUND_DEBOUNCE_MS) {
        return;
      }
      lastForegroundAtRef.current = now;

      // Já no dashboard: só renova auth + heartbeat (evita storm de POST claim).
      if (readyRef.current) {
        await refreshAuthSessionClient();
        await heartbeat();
        return;
      }

      await refreshAuthSessionClient();
      await registerSession();
      await heartbeat();
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void onForeground(false);
      }
    };

    const onWindowFocus = () => {
      void onForeground(false);
    };

    document.addEventListener("visibilitychange", onVisibility);
    // focus dispara demais (DevTools, toasts); visibility cobre retorno à aba.
    // Mantemos focus com debounce só como fallback desktop.
    window.addEventListener("focus", onWindowFocus);

    // Só mostra spinner no boot — não volte a `false` se já estávamos ready
    // (evita flash/loop ao remontar em Strict Mode após sucesso).
    if (!readyRef.current) {
      setReady(false);
    }

    void (async () => {
      await refreshAuthSessionClient();
      if (cancelled) return;
      const ok = await registerSession();
      if (cancelled) return;
      if (!ok) return;

      heartbeatTimer = setInterval(() => {
        void heartbeat();
      }, ACCESS_SESSION_HEARTBEAT_MS);

      setReady(true);
    })();

    return () => {
      cancelled = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onWindowFocus);
    };
  }, [router, onPlanos]);

  if (!ready) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <>{children}</>;
}
