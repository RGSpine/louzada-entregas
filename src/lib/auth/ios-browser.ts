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

export function openInSafariHintMessage(): string {
  if (isInAppBrowser()) {
    return "Você está no navegador do app (WhatsApp/Instagram). Toque em ⋯ ou Compartilhar → Abrir no Safari para concluir o cadastro e o pagamento.";
  }
  return "No iPhone, use o Safari (não o navegador dentro de outros apps) para login e pagamento funcionarem sem erro.";
}
