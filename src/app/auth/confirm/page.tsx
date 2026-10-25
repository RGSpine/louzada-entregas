"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { exchangeAuthSession, parseSupabaseHashTokens } from "@/lib/auth-exchange-client";

export default function AuthConfirmPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background">
          <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
          <p className="text-muted-foreground">Carregando...</p>
        </div>
      }
    >
      <AuthConfirmContent />
    </Suspense>
  );
}

function AuthConfirmContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleConfirm = async () => {
      const code = searchParams.get("code");
      const tokenHash = searchParams.get("token_hash");
      const type = searchParams.get("type");

      try {
        if (tokenHash && type) {
          const otpType = type as "email" | "magiclink" | "recovery" | "signup" | "invite";
          const result = await exchangeAuthSession({
            kind: "otp",
            tokenHash,
            type: otpType,
          });
          if (!result.ok) throw new Error(result.error);
          if (otpType === "recovery") {
            toast.success("Link validado! Defina sua nova senha.");
            router.replace("/reset-password?from=recovery");
            return;
          }
          toast.success("E-mail confirmado! Redirecionando...");
          router.replace("/dashboard");
          return;
        }

        if (code) {
          const result = await exchangeAuthSession({ kind: "code", code });
          if (!result.ok) throw new Error(result.error);
          toast.success("E-mail confirmado! Redirecionando...");
          router.replace("/dashboard");
          return;
        }

        const hash = typeof window !== "undefined" ? window.location.hash : "";
        if (hash) {
          const { accessToken, refreshToken } = parseSupabaseHashTokens(hash);
          if (accessToken && refreshToken) {
            const result = await exchangeAuthSession({
              kind: "tokens",
              accessToken,
              refreshToken,
            });
            if (!result.ok) throw new Error(result.error);
            toast.success("E-mail confirmado! Redirecionando...");
            router.replace("/dashboard");
            return;
          }
        }

        setError("Link inválido ou expirado. Faça login ou solicite um novo e-mail de confirmação.");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro ao confirmar e-mail";
        console.error("[auth/confirm]", err);
        setError(msg);
        toast.error("Link inválido ou expirado. Tente fazer login ou reenvie o e-mail de confirmação.");
      }
    };

    void handleConfirm();
  }, [router, searchParams]);

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background">
        <p className="text-muted-foreground text-center mb-6">{error}</p>
        <a
          href="/login"
          className="text-primary dark:text-primary hover:underline font-medium"
        >
          Ir para o login
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background">
      <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
      <p className="text-muted-foreground">Confirmando seu e-mail...</p>
    </div>
  );
}
