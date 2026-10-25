"use client";

import Link from "next/link";
import { Crown, Lock, Zap } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  premiumFeatureUpsellPath,
  type PremiumFeatureId,
  PREMIUM_FEATURES,
} from "@/lib/premium-feature-upsell";

type Props = {
  featureId: PremiumFeatureId;
  className?: string;
  children?: React.ReactNode;
  allowed: boolean;
  /**
   * Plano ainda a carregar — não mostrar teaser de upgrade nem o conteúdo gated
   * (evita flash de “faça upgrade” em contas com acesso).
   */
  pending?: boolean;
};

/**
 * Mostra o conteúdo real ou um card clicável (mesmo lugar visual) que leva à página de upgrade.
 */
export function PremiumFeatureTeaserCard({
  featureId,
  className,
  children,
  allowed,
  pending = false,
}: Props) {
  if (pending) {
    return (
      <Card className={cn("border-border bg-white shadow-sm dark:bg-card", className)}>
        <CardContent className="flex min-h-[8rem] items-center justify-center py-10 text-sm text-muted-foreground">
          Carregando…
        </CardContent>
      </Card>
    );
  }

  if (allowed) {
    return className ? <div className={cn("h-full min-h-0", className)}>{children}</div> : <>{children}</>;
  }

  const feature = PREMIUM_FEATURES[featureId];
  const href = premiumFeatureUpsellPath(featureId);
  const isPro = feature.requiredPlan === "PREMIUM";

  return (
    <Link href={href} className={cn("group block", className)}>
      <Card
        className={cn(
          "h-full cursor-pointer border-dashed transition-all hover:shadow-[var(--shadow-elevation-2)]",
          isPro
            ? "border-success/40 bg-gradient-to-b from-success/10 to-card hover:border-success/60 dark:from-success/20 dark:to-card"
            : "border-primary/40 bg-gradient-to-b from-primary/10 to-card hover:border-primary/60 dark:from-primary/20 dark:to-card",
        )}
      >
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-foreground">
            {feature.title}
            <Badge
              variant="outline"
              className={isPro ? "border-success/40 text-success" : "border-primary/40 text-primary"}
            >
              {isPro ? (
                <>
                  <Crown className="mr-1 h-3 w-3" aria-hidden />
                  Premium
                </>
              ) : (
                <>
                  <Zap className="mr-1 h-3 w-3" aria-hidden />
                  Profissional
                </>
              )}
            </Badge>
          </CardTitle>
          <CardDescription>{feature.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className={cn(
              "flex items-center justify-center gap-2 rounded-lg border px-4 py-6 text-sm font-medium transition-colors",
              isPro
                ? "border-success/30 bg-success/10 text-success group-hover:bg-success/15"
                : "border-primary/30 bg-primary/10 text-primary group-hover:bg-primary/15",
            )}
          >
            <Lock className="h-4 w-4 shrink-0" aria-hidden />
            Toque para conhecer e fazer upgrade
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
