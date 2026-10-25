"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

const PLANOS_PATH = "/dashboard";

type Props = {
  children: React.ReactNode;
};

/**
 * Barreira client-side: com checkout pendente, só /dashboard/planos renderiza.
 * Usado no shell mínimo do layout (sem sidebar) — evita prefetch de Links do
 * chrome completo que gerava loop redirect planos ↔ dashboard.
 */
export function PendingCheckoutGate({ children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const redirected = useRef(false);
  const onPlanos =
    pathname === PLANOS_PATH || Boolean(pathname?.startsWith(`${PLANOS_PATH}/`));

  useEffect(() => {
    if (onPlanos) {
      redirected.current = false;
      return;
    }
    if (redirected.current) return;
    redirected.current = true;
    router.replace(`${PLANOS_PATH}?from=signup`);
  }, [onPlanos, router]);

  if (!onPlanos) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-4">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-center text-sm text-muted-foreground">
          Escolha um plano e conclua o pagamento para acessar o sistema.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
