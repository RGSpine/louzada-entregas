"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { claimAccessSessionClient } from "@/lib/access-session-client";
import { logoutAction } from "@/app/actions/auth";

function OAuthSuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const run = async () => {
      const nextRaw = searchParams.get("next");
      const next =
        nextRaw?.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/dashboard";

      const claimed = await claimAccessSessionClient();
      if (!claimed.ok) {
        if (claimed.errorCode === "CHECKOUT_REQUIRED") {
          router.replace(claimed.redirectTo ?? "/dashboard");
          return;
        }
        toast.error(
          claimed.error ??
            "Limite de acessos simultâneos atingido. Encerre a sessão em outro dispositivo e tente novamente.",
          { duration: 9000 },
        );
        try {
          await logoutAction();
        } catch {
          // ignore
        }
        router.replace("/login?reason=access_limit");
        return;
      }

      toast.success("Login realizado com sucesso!");
      router.replace(next);
    };

    void run();
  }, [router, searchParams]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background">
      <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
      <p className="text-muted-foreground">Finalizando login com Google...</p>
    </div>
  );
}

export default function OAuthSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background">
          <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
          <p className="text-muted-foreground">Carregando...</p>
        </div>
      }
    >
      <OAuthSuccessContent />
    </Suspense>
  );
}
