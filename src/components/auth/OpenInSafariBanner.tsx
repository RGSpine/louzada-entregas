"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { IosSafariHandoff } from "@/components/pwa/IosInstallSteps";
import {
  detectIosShell,
  isInAppBrowser,
  openInSafariHintMessage,
  type IosShell,
} from "@/lib/auth/ios-browser";
import { cn } from "@/lib/utils";

type Props = {
  className?: string;
  /** Se true, só mostra em in-app browser (omite Safari puro). */
  onlyInApp?: boolean;
};

/**
 * Aviso para iPhone / WhatsApp / Instagram: cookies de sessão falham nestes browsers.
 */
export function OpenInSafariBanner({ className, onlyInApp = false }: Props) {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("");
  const [shell, setShell] = useState<IosShell | null>(null);

  useEffect(() => {
    const detected = detectIosShell();
    const show = onlyInApp ? isInAppBrowser() : detected != null && detected !== "safari";
    if (!show || !detected || detected === "safari") return;
    setShell(detected);
    setMessage(openInSafariHintMessage());
    setVisible(true);
  }, [onlyInApp]);

  if (!visible) return null;

  return (
    <div
      role="status"
      className={cn(
        "rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-foreground",
        className,
      )}
    >
      <p className="flex gap-2 leading-snug">
        <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
        <span>{message}</span>
      </p>
      {shell ? (
        <div className="mt-2">
          <IosSafariHandoff />
        </div>
      ) : null}
    </div>
  );
}
