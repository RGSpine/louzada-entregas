"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  isGaConfigured,
  readAnalyticsConsent,
  writeAnalyticsConsent,
  type AnalyticsConsent,
} from "@/lib/analytics/ga";

function notifyConsentChange() {
  window.dispatchEvent(new Event("aievolui-analytics-consent"));
}

/**
 * Banner LGPD simples — Analytics só após Aceitar.
 * Recusar grava preferência e não carrega GA4.
 */
export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isGaConfigured()) return;
    if (readAnalyticsConsent() == null) setVisible(true);
  }, []);

  if (!visible) return null;

  const choose = (value: AnalyticsConsent) => {
    writeAnalyticsConsent(value);
    setVisible(false);
    notifyConsentChange();
  };

  return (
    <div
      role="dialog"
      aria-label="Preferências de cookies e medições"
      className="fixed inset-x-0 bottom-0 z-[200] border-t border-border bg-card/95 p-4 shadow-lg backdrop-blur-sm md:p-5"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Usamos cookies de medição (Google Analytics) para entender o uso do site e melhorar o
          produto. Dados clínicos de pacientes não entram nessa medição. Veja a{" "}
          <Link href="/privacidade" className="underline underline-offset-2 hover:text-foreground">
            Política de Privacidade
          </Link>
          .
        </p>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={() => choose("denied")}>
            Recusar medições
          </Button>
          <Button type="button" onClick={() => choose("granted")}>
            Aceitar medições
          </Button>
        </div>
      </div>
    </div>
  );
}
