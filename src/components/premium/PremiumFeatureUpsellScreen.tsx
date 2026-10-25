"use client";

import Link from "next/link";
import { Crown, Sparkles, Zap } from "lucide-react";
import { BackNavLink } from "@/components/navigation/BackNav";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  premiumAvailabilityMessage,
  premiumFeatureUpsellPath,
  type PremiumFeatureDef,
  type PremiumRequiredPlan,
} from "@/lib/premium-feature-upsell";

type Props = {
  feature: PremiumFeatureDef;
  featureId?: string;
};

function PlanBadge({ requiredPlan }: { requiredPlan: PremiumRequiredPlan }) {
  if (requiredPlan === "PREMIUM") {
    return (
      <Badge className="border-success/30 bg-success/15 text-success">
        <Crown className="mr-1 h-3 w-3" aria-hidden />
        Premium
      </Badge>
    );
  }
  return (
    <Badge className="border-primary/30 bg-primary/15 text-primary">
      <Zap className="mr-1 h-3 w-3" aria-hidden />
      Profissional
    </Badge>
  );
}

export function PremiumFeatureUpsellScreen({ feature, featureId }: Props) {
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-gradient-to-b from-muted via-primary/10 to-background px-4 py-10 dark:from-background dark:via-primary/20 dark:to-background">
      <div className="container mx-auto max-w-lg">
        <BackNavLink href="/dashboard" className="mb-6" />

        <Card className="overflow-hidden border-2 border-primary/30 bg-card shadow-[var(--shadow-elevation-3)]">
          <div className="h-1.5 bg-gradient-to-r from-primary via-clinical to-success" aria-hidden />
          <CardHeader className="space-y-4 pb-2 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-clinical shadow-[var(--shadow-elevation-2)]">
              <Sparkles className="h-8 w-8 text-primary-foreground" aria-hidden />
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <CardTitle className="text-2xl text-foreground">{feature.title}</CardTitle>
              <PlanBadge requiredPlan={feature.requiredPlan} />
            </div>
            <CardDescription className="text-base leading-relaxed text-muted-foreground">
              {feature.description}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pb-8 pt-2 text-center">
            <p className="text-lg font-semibold text-foreground">
              {premiumAvailabilityMessage(feature.requiredPlan)}
            </p>
            <p className="text-base text-muted-foreground">
              Quer ter acesso a essas ferramentas? Faça seu upgrade!
            </p>
            <Button asChild size="lg" variant="clinical" className="h-12 w-full text-base font-semibold">
              <Link href="/dashboard/planos">Ver planos e fazer upgrade</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function PremiumFeatureUpsellFallback() {
  return (
    <PremiumFeatureUpsellScreen
      feature={{
        requiredPlan: "PREMIUM",
        title: "Recurso premium",
        description: "Esta ferramenta faz parte dos planos pagos do Louzada Entregas.",
      }}
    />
  );
}

export { premiumFeatureUpsellPath };
