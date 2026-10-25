"use client";

import Script from "next/script";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  GA_MEASUREMENT_ID,
  isGaConfigured,
  readAnalyticsConsent,
} from "@/lib/analytics/ga";

function pagePathFrom(
  pathname: string | null,
  searchParams: ReturnType<typeof useSearchParams>,
): string {
  const path = pathname || "/";
  const qs = searchParams?.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Carrega gtag somente com Measurement ID + consentimento concedido.
 * page_view: envio manual (send_page_view: false) para App Router + SPA.
 */
export function GoogleAnalytics() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => {
      const ok = isGaConfigured() && readAnalyticsConsent() === "granted";
      setEnabled(ok);
      if (!ok) setReady(false);
    };
    sync();
    window.addEventListener("aievolui-analytics-consent", sync);
    return () => window.removeEventListener("aievolui-analytics-consent", sync);
  }, []);

  useEffect(() => {
    if (!enabled || !ready || !window.gtag) return;
    window.gtag("event", "page_view", {
      page_path: pagePathFrom(pathname, searchParams),
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [enabled, ready, pathname, searchParams]);

  if (!enabled || !isGaConfigured()) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
        onLoad={() => setReady(true)}
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          window.gtag = gtag;
          gtag('js', new Date());
          gtag('config', '${GA_MEASUREMENT_ID}', { send_page_view: false, anonymize_ip: true });
        `}
      </Script>
    </>
  );
}
