"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Crown } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ProFeatureGateProps = {
  allowed: boolean;
  title: string;
  description: string;
  upsellMessage: string;
  children: ReactNode;
};

export function ProFeatureGate({
  allowed,
  title,
  description,
  upsellMessage,
  children,
}: ProFeatureGateProps) {
  if (allowed) return <>{children}</>;

  return (
    <Card className="border-success/30 bg-gradient-to-b from-success/10 to-card">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-foreground">
          <Crown className="h-5 w-5 text-success" aria-hidden />
          {title}
          <Badge className="border-success/30 bg-success/15 text-success">PRO</Badge>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">{upsellMessage}</p>
        <Button asChild variant="clinical">
          <Link href="/dashboard/planos">Ver planos PRO</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
