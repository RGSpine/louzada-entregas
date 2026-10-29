/**
 * Detecção de ambientes WebKit / in-app no iOS que quebram cookies de sessão
 * (WhatsApp, Instagram, Facebook, LinkedIn, etc.).
 */

export function getBrowserUserAgent(ua?: string | null): string {
  if (typeof ua === "string") return ua;
  if (typeof navigator !== "undefined") return navigator.userAgent || "";
  return "";
}

/** iPhone / iPad / iPod (inclui iPadOS desktop UA). */
export function isAppleMobileDevice(ua?: string | null): boolean {
  const s = getBrowserUserAgent(ua);
  if (/iPhone|iPod|iPad/i.test(s)) return true;
  // iPadOS 13+ reporta Macintosh + touch
  if (typeof navigator !== "undefined" && /Macintosh/i.test(s) && navigator.maxTouchPoints > 1) {
    return true;
  }
  return false;
}

/**
 * Navegador embutido (SFSafariViewController / WKWebView de apps).
 * Sessão Auth costuma falhar no redirect Login → Planos → Stripe.
 */
export function isInAppBrowser(ua?: string | null): boolean {
  const s = getBrowserUserAgent(ua);
  if (!s) return false;
  // Apps sociais / mensagens
  if (
    /FBAN|FBAV|FB_IAB|Instagram|Line\/|LinkedInApp|Twitter|TikTok|BytedanceWebview|Snapchat|WhatsApp|MicroMessenger|GSA\//i.test(
      s,
    )
  ) {
    return true;
  }
  // WKWebView sem Safari na UA (exceto Chrome/Firefox/Edge iOS)
  if (isAppleMobileDevice(s) && /AppleWebKit/i.test(s)) {
    const isRealSafari = /Safari/i.test(s) && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(s);
    // Instagram etc. às vezes incluem Safari; já cobertos acima.
    // WKWebView puro: sem Version/X Safari pattern típico — difícil; FB/IG já pegos.
    if (!isRealSafari && !/CriOS|FxiOS|EdgiOS/i.test(s)) return true;
  }
  return false;
}

/** Onde o iPhone abriu a página. A instalação na tela inicial só existe no Safari. */
export type IosShell = "safari" | "chrome" | "google" | "firefox" | "edge" | "in-app" | "other";

export function detectIosShell(ua?: string | null): IosShell | null {
  if (!isAppleMobileDevice(ua)) return null;
  const s = getBrowserUserAgent(ua);
  if (/GSA\//i.test(s)) return "google";
  if (/CriOS/i.test(s)) return "chrome";
  if (/FxiOS/i.test(s)) return "firefox";
  if (/EdgiOS/i.test(s)) return "edge";
  if (isInAppBrowser(s)) return "in-app";
  if (/Version\/[\d.]+/i.test(s) && /Safari/i.test(s)) return "safari";
  return "other";
}

export function iosShellLabel(shell: IosShell): string {
  switch (shell) {
    case "safari":
      return "Safari";
    case "chrome":
      return "Chrome";
    case "google":
      return "Google";
    case "firefox":
      return "Firefox";
    case "edge":
      return "Edge";
    case "in-app":
      return "navegador do aplicativo";
    default:
      return "este navegador";
  }
}

/** Abre a mesma página no Safari. O iPhone aceita esse endereço a partir do Chrome, do Google e de outros apps. */
export function safariHandoffUrl(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `x-safari-${url.protocol}//${url.host}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/** Safari iOS (não Chrome/Firefox/Edge no iPhone). */
export function isAppleMobileSafari(ua?: string | null): boolean {
  const s = getBrowserUserAgent(ua);
  if (!isAppleMobileDevice(s)) return false;
  if (/CriOS|FxiOS|EdgiOS|OPiOS/i.test(s)) return false;
  return /Safari/i.test(s) || /AppleWebKit/i.test(s);
}

/**
 * Ambientes onde cookies de Server Action + location.assign falham com frequência.
 * Preferir login via Route Handler + aguardar sessão antes de navegar.
 */
export function needsSafariAuthHardening(ua?: string | null): boolean {
  return isInAppBrowser(ua) || isAppleMobileSafari(ua) || isAppleMobileDevice(ua);
}

export function openInSafariHintMessage(ua?: string | null): string {
  const shell = detectIosShell(ua);
  if (shell && shell !== "safari") {
    return `Você abriu pelo ${iosShellLabel(shell)}. O iPhone só coloca o Louzada na tela inicial pelo Safari. Toque em Abrir no Safari e siga os três passos.`;
  }
  return "No iPhone, use o Safari para colocar o Louzada na tela inicial.";
}
