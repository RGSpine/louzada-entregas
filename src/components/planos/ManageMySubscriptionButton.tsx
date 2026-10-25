"use client";

import Link from "next/link";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ManageSubscriptionButton } from "@/components/stripe/ManageSubscriptionButton";
import type { PlanTier } from "@/lib/plan-tier";

type Props = {
  currentPlan: PlanTier | null;
  hasStripeSubscription: boolean;
  className?: string;
};

/**
 * Plano Básico → perfil (cancelar conta).
 * Planos pagos com Stripe → portal de assinatura.
 */
export function ManageMySubscriptionButton({
  currentPlan,
  hasStripeSubscription,
  className,
}: Props) {
  if (!currentPlan || currentPlan === "BASICO" || !hasStripeSubscription) {
    return (
      <Button
        variant="outline"
        className={
          className ??
          "w-full border-border bg-card font-medium text-foreground hover:bg-muted"
        }
        asChild
      >
        <Link href="/dashboard/profile">
          <Settings className="h-4 w-4" />
          Gerenciar Assinatura
        </Link>
      </Button>
    );
  }

  return <ManageSubscriptionButton className={className} />;
}
