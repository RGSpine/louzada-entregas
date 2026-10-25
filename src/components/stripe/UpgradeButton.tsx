"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  hardNavigate,
  waitForAuthSession,
} from "@/lib/auth/ensure-session-client";
import { isInAppBrowser, needsSafariAuthHardening } from "@/lib/auth/ios-browser";

export function UpgradeButton({
  className,
  children = "Assinar",
  planType,
  interval,
  couponCode,
  onCouponAlreadyUsed,
}: {
  className?: string;
  children?: React.ReactNode;
  planType?: "BASICO" | "PROFISSIONAL" | "PREMIUM" | "CONSULTORIO" | "CLINICA";
  interval?: "MONTHLY" | "ANNUAL";
  couponCode?: string;
  onCouponAlreadyUsed?: () => void;
}) {
  const [loading, setLoading] = useState(false);

  const handleUpgrade = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const postCheckout = () =>
        fetch("/api/stripe/checkout", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            planType: planType ?? "PREMIUM",
            interval: interval ?? "MONTHLY",
            couponCode: couponCode?.trim() || undefined,
          }),
        });

      let res = await postCheckout();
      let data = await res.json().catch(() => ({}));

      // iOS: cookie ainda não visível → refresh + 1 retry.
      if (res.status === 401) {
        const recovered = await waitForAuthSession({ maxAttempts: 4, baseDelayMs: 150 });
        if (recovered) {
          res = await postCheckout();
          data = await res.json().catch(() => ({}));
        }
      }

      if (!res.ok) {
        if (data?.errorCode === "COUPON_ALREADY_USED") {
          onCouponAlreadyUsed?.();
          toast.error("Você já usou seu cupom único.");
          setLoading(false);
          return;
        }
        if (res.status === 401) {
          const iosHint =
            isInAppBrowser() || needsSafariAuthHardening()
              ? " No iPhone, abra o Safari (fora do WhatsApp/Instagram) e faça login de novo antes de assinar."
              : "";
          toast.error(
            `Sessão expirada.${iosHint || " Faça login novamente para continuar."}`,
            { duration: 12000 },
          );
          hardNavigate(
            `/login?reason=session_expired&redirect=${encodeURIComponent("/dashboard/planos")}`,
          );
          return;
        }
        toast.error(data.error ?? "Erro ao iniciar checkout.");
        setLoading(false);
        return;
      }

      if (data.url) {
        toast.success("Redirecionando para o checkout...");
        hardNavigate(data.url);
        return;
      }

      toast.error("Resposta inválida do servidor.");
      setLoading(false);
    } catch (err) {
      console.error("[UpgradeButton]", err);
      toast.error("Erro de conexão. Tente novamente.");
      setLoading(false);
    }
  };

  return (
    <Button
      onClick={handleUpgrade}
      disabled={loading}
      className={
        className ??
        "h-auto min-h-9 w-full whitespace-normal px-3 py-2 text-center text-sm font-semibold leading-snug shadow-[var(--shadow-elevation-2)] transition-all hover:shadow-[var(--shadow-elevation-3)]"
      }
      variant="clinical"
    >
      {loading ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          Redirecionando...
        </>
      ) : (
        <>
          <Sparkles className="w-4 h-4" />
          {children}
        </>
      )}
    </Button>
  );
}
