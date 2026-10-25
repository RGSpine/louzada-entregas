/** GA4 — só dispara após consentimento LGPD (ver CookieConsent). */

export const GA_MEASUREMENT_ID =
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim() || "";

export const ANALYTICS_CONSENT_KEY = "aievolui_analytics_consent";

export type AnalyticsConsent = "granted" | "denied";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function isGaConfigured(): boolean {
  return GA_MEASUREMENT_ID.length > 0 && GA_MEASUREMENT_ID.startsWith("G-");
}

export function readAnalyticsConsent(): AnalyticsConsent | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(ANALYTICS_CONSENT_KEY);
    if (v === "granted" || v === "denied") return v;
  } catch {
    /* private mode */
  }
  return null;
}

export function writeAnalyticsConsent(value: AnalyticsConsent): void {
  try {
    localStorage.setItem(ANALYTICS_CONSENT_KEY, value);
  } catch {
    /* ignore */
  }
}

/** Evento de conversão principal: cadastro / início do trial (14 dias). */
export function trackSignUp(method: "email" | "google" = "email"): void {
  if (typeof window === "undefined" || !window.gtag) return;
  if (readAnalyticsConsent() !== "granted") return;
  window.gtag("event", "sign_up", { method });
}

/** Clique em CTA de marketing (não é conversão principal). */
export function trackCtaClick(placement: string, href?: string): void {
  if (typeof window === "undefined" || !window.gtag) return;
  if (readAnalyticsConsent() !== "granted") return;
  window.gtag("event", "cta_click", {
    placement,
    link_url: href,
  });
}
