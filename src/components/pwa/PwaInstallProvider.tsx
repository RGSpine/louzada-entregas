"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  detectPwaInstallPlatform,
  dismissInstallBanner,
  isAndroidDevice,
  isInstallBannerDismissed,
  isIOSDevice,
  isLocalDevHost,
  isPwaInstallSupportedEnvironment,
  isPwaStandalone,
  type PwaInstallPlatform,
} from "@/lib/pwa-install";
import { PwaInstallBanner } from "@/components/pwa/PwaInstallBanner";
import {
  PwaInstallGuideModal,
  type PwaInstallGuideKind,
} from "@/components/pwa/PwaInstallGuideModal";

type PwaInstallContextValue = {
  visible: boolean;
  platform: PwaInstallPlatform;
  canNativePrompt: boolean;
  guideKind: PwaInstallGuideKind | null;
  installing: boolean;
  localDevHint: boolean;
  install: () => Promise<void>;
  dismiss: () => void;
  closeGuide: () => void;
};

const PwaInstallContext = createContext<PwaInstallContextValue | null>(null);

export function usePwaInstall(): PwaInstallContextValue | null {
  return useContext(PwaInstallContext);
}

function guideKindForPlatform(): PwaInstallGuideKind {
  if (isIOSDevice()) return "ios";
  if (isAndroidDevice()) return "android";
  return "desktop";
}

export function PwaInstallProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [guideKind, setGuideKind] = useState<PwaInstallGuideKind | null>(null);
  const [installing, setInstalling] = useState(false);
  const [platform, setPlatform] = useState<PwaInstallPlatform>("unknown");
  const [localDevHint, setLocalDevHint] = useState(false);

  const installEnvOk = isPwaInstallSupportedEnvironment();

  useEffect(() => {
    setPlatform(detectPwaInstallPlatform());
    setLocalDevHint(isLocalDevHost());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || !installEnvOk) return;
    if (isPwaStandalone() || isInstallBannerDismissed()) return;

    const onBeforeInstall = (event: BeforeInstallPromptEvent) => {
      event.preventDefault();
      setDeferredPrompt(event);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, [ready, installEnvOk]);

  useEffect(() => {
    if (!ready || !installEnvOk) return;
    if (isPwaStandalone() || isInstallBannerDismissed()) return;
    if (deferredPrompt) return;

    if (isIOSDevice()) {
      const timer = window.setTimeout(() => setVisible(true), 1200);
      return () => window.clearTimeout(timer);
    }

    if (isAndroidDevice()) {
      const timer = window.setTimeout(() => {
        if (!isPwaStandalone() && !isInstallBannerDismissed()) {
          setVisible(true);
        }
      }, 2500);
      return () => window.clearTimeout(timer);
    }

    // Desktop: só após critérios PWA (SW + manifest) — evita banner inútil no dev.
    const timer = window.setTimeout(() => {
      if (!isPwaStandalone() && !isInstallBannerDismissed()) {
        setVisible(true);
      }
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [ready, installEnvOk, deferredPrompt]);

  useEffect(() => {
    const onInstalled = () => {
      setVisible(false);
      setDeferredPrompt(null);
      setGuideKind(null);
    };
    window.addEventListener("appinstalled", onInstalled);
    return () => window.removeEventListener("appinstalled", onInstalled);
  }, []);

  const dismiss = useCallback(() => {
    dismissInstallBanner();
    setVisible(false);
    setGuideKind(null);
  }, []);

  const closeGuide = useCallback(() => {
    setGuideKind(null);
  }, []);

  const install = useCallback(async () => {
    if (deferredPrompt) {
      setInstalling(true);
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === "accepted") {
          setVisible(false);
        } else {
          setGuideKind(guideKindForPlatform());
        }
        setDeferredPrompt(null);
      } catch {
        setGuideKind(guideKindForPlatform());
        setDeferredPrompt(null);
      } finally {
        setInstalling(false);
      }
      return;
    }

    setGuideKind(guideKindForPlatform());
  }, [deferredPrompt]);

  const value = useMemo<PwaInstallContextValue>(
    () => ({
      visible: installEnvOk && visible,
      platform,
      canNativePrompt: Boolean(deferredPrompt),
      guideKind,
      installing,
      localDevHint,
      install,
      dismiss,
      closeGuide,
    }),
    [
      installEnvOk,
      visible,
      platform,
      deferredPrompt,
      guideKind,
      installing,
      localDevHint,
      install,
      dismiss,
      closeGuide,
    ],
  );

  return (
    <PwaInstallContext.Provider value={value}>
      {children}
      <PwaInstallBanner />
      <PwaInstallGuideModal
        kind={guideKind}
        open={guideKind !== null}
        onClose={closeGuide}
        localDevHint={localDevHint}
      />
    </PwaInstallContext.Provider>
  );
}
