"use client";

import { useState } from "react";
import { Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import { detectIosShell, iosShellLabel, safariHandoffUrl, type IosShell } from "@/lib/auth/ios-browser";

export const IOS_INSTALL_STEPS = [
  "Olhe a barra de baixo. Toque no quadrado com a seta para cima. O nome dele é Compartilhar.",
  "Desça a lista com o dedo. Toque em Adicionar à Tela de Início.",
  "Toque em Adicionar. O desenho do Louzada aparece na tela do iPhone. Abra sempre por esse desenho.",
] as const;

export function IosInstallSteps({ shell }: { shell: IosShell | null }) {
  const needsSafari = shell != null && shell !== "safari";
  return (
    <div className="mt-3 space-y-3">
      {needsSafari ? (
        <p className="text-base font-medium leading-snug text-foreground">
          Você abriu pelo {iosShellLabel(shell)}. Toque no botão azul. Ele abre esta página no Safari.
        </p>
      ) : (
        <p className="text-base font-medium leading-snug text-foreground">
          Faça os três toques abaixo. O desenho do Louzada fica na tela do iPhone.
        </p>
      )}
      {needsSafari ? <IosSafariHandoff /> : null}
      <ol className="space-y-3">
        {IOS_INSTALL_STEPS.map((step, index) => (
          <li key={step} className="flex gap-3 text-base leading-snug text-foreground">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
              {index + 1}
            </span>
            <span className="pt-1">
              {index === 0 ? (
                <Share className="mr-1 inline h-5 w-5 align-text-bottom text-primary" aria-hidden />
              ) : null}
              {step}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function IosSafariHandoff() {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  function openSafari() {
    const href = safariHandoffUrl(window.location.href);
    if (!href) {
      setFailed(true);
      return;
    }
    window.location.href = href;
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" size="lg" className="h-14 w-full text-lg font-bold" onClick={openSafari}>
        Abrir no Safari
      </Button>
      <Button type="button" size="lg" variant="outline" className="h-12 w-full text-base" onClick={() => void copyLink()}>
        {copied ? "Link copiado" : "Copiar o link"}
      </Button>
      {failed ? (
        <p className="text-sm text-muted-foreground">
          Se o Safari não abrir, toque em Copiar o link. Depois abra o Safari e cole o link na barra de cima.
        </p>
      ) : null}
    </div>
  );
}

export function currentIosShell(): IosShell | null {
  return detectIosShell();
}
