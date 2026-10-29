/** Detecção e persistência do prompt de instalação PWA. */

export const PWA_INSTALL_DISMISS_KEY = "aievolui-pwa-install-dismissed-at";

export type PwaInstallPlatform = "android" | "ios" | "desktop" | "unknown";

declare global {
  interface BeforeInstallPromptEvent extends Event {
    readonly platforms: string[];
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  }
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

export function isPwaStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches
  );
}

export function isIOSDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function isAndroidDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

export function detectPwaInstallPlatform(): PwaInstallPlatform {
  if (isIOSDevice()) return "ios";
  if (isAndroidDevice()) return "android";
  if (typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches) {
    return "desktop";
  }
  return "unknown";
}

/** Fechar o aviso vale só nesta visita. A próxima abertura mostra de novo, na hora. */
export function isInstallBannerDismissed(): boolean {
  return false;
}

export function dismissInstallBanner(): void {
  clearInstallBannerDismiss();
}

export function clearInstallBannerDismiss(): void {
  try {
    localStorage.removeItem(PWA_INSTALL_DISMISS_KEY);
  } catch {
    /* ignore */
  }
}

/** Rotas onde o banner faz sentido (área logada + entrada do produto). */
export function shouldOfferPwaInstallOnPath(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname.startsWith("/como-baixar-app")) return false;
  if (pathname.startsWith("/admin")) return false;
  return (
    pathname === "/" ||
    pathname.startsWith("/profissional") ||
    pathname.startsWith("/paciente") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/mapa-saude")
  );
}

export function pwaInstallTutorialHash(platform: PwaInstallPlatform): string {
  if (platform === "ios") return "#ios";
  if (platform === "android") return "#android";
  if (platform === "desktop") return "#windows";
  return "";
}

export function isLocalDevHost(hostname?: string): boolean {
  const h =
    hostname ??
    (typeof window !== "undefined" ? window.location.hostname : "");
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

/**
 * Instalação PWA só em produção (HTTPS) ou localhost com flag explícita (`pwa:test`).
 * Em `next dev` sem SW o prompt quebra sessão/ícone — não exibir banner.
 */
export function isPwaInstallSupportedEnvironment(): boolean {
  if (typeof window === "undefined") return false;
  if (process.env.NEXT_PUBLIC_ENABLE_PWA_INSTALL_DEV === "1") return true;
  if (process.env.NODE_ENV !== "production") return false;
  if (isLocalDevHost()) return false;
  return window.isSecureContext;
}
