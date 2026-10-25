"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { PlanAccessGate } from "@/app/actions/plan-access";
import { LegacyFreeSunsetBanner } from "@/components/dashboard/LegacyFreeSunsetBanner";

type Props = {
  gate: PlanAccessGate;
};

const PLANOS_PATH = "/dashboard";

export function PlanAccessGateClient({ gate }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const redirected = useRef(false);

  useEffect(() => {
    const onPlanos = pathname === PLANOS_PATH || pathname.startsWith(`${PLANOS_PATH}/`);

    // Em /planos: libera o ref para poder re-bloquear se o user sair sem assinar
    if (onPlanos) {
      redirected.current = false;
      return;
    }

    if (redirected.current) return;

    // Sem assinatura obrigatória: leva à escolha de plano (não força checkout do Básico)
    if (gate.needsBasicoCheckout) {
      redirected.current = true;
      router.replace(`${PLANOS_PATH}?from=signup`);
      return;
    }

    if (gate.legacyGraceExpired) {
      redirected.current = true;
      router.replace(`${PLANOS_PATH}?legacy=expired`);
    }
  }, [gate.needsBasicoCheckout, gate.legacyGraceExpired, pathname, router]);

  if (!gate.showLegacySunsetBanner) return null;

  return (
    <div className="container mx-auto max-w-5xl px-4 pt-4">
      <LegacyFreeSunsetBanner
        daysRemaining={gate.legacyGraceDaysRemaining ?? LEGACY_GRACE_FALLBACK_DAYS}
      />
    </div>
  );
}

const LEGACY_GRACE_FALLBACK_DAYS = 7;
