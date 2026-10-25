"use client";

import Link from "next/link";
import { Monitor, Share, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClinicalCalmModal } from "@/components/ui/ClinicalCalmModal";
import { pwaInstallTutorialHash, type PwaInstallPlatform } from "@/lib/pwa-install";

export type PwaInstallGuideKind = "ios" | "android" | "desktop";

const GUIDE_COPY: Record<
  PwaInstallGuideKind,
  { title: string; subtitle: string; steps: string[]; hashPlatform: PwaInstallPlatform }
> = {
  ios: {
    title: "Instalar no iPhone",
    subtitle: "O Safari não permite instalação automática — são 3 toques:",
    hashPlatform: "ios",
    steps: [
      "Toque em Compartilhar na barra inferior do Safari.",
      "Escolha Adicionar à Tela de Início.",
      "Confirme em Adicionar e abra sempre pelo ícone na tela inicial.",
    ],
  },
  android: {
    title: "Instalar no Android",
    subtitle: "Se o prompt nativo não apareceu, use o menu do Chrome:",
    hashPlatform: "android",
    steps: [
      "Toque no menu (⋮) no canto superior direito do Chrome.",
      "Escolha Instalar app ou Adicionar à tela inicial.",
      "Confirme e abra pelo ícone na tela inicial.",
    ],
  },
  desktop: {
    title: "Instalar no computador",
    subtitle: "Use o ícone de instalação na barra de endereço do Chrome ou Edge:",
    hashPlatform: "desktop",
    steps: [
      "Procure o ícone de instalar (⊕ ou monitor) à direita da barra de endereço.",
      "Clique em Instalar ou Instalar Louzada Entregas.",
      "Abra pelo atalho criado na área de trabalho ou menu Iniciar.",
    ],
  },
};

export function PwaInstallGuideModal({
  kind,
  open,
  onClose,
  localDevHint,
}: {
  kind: PwaInstallGuideKind | null;
  open: boolean;
  onClose: () => void;
  localDevHint?: boolean;
}) {
  if (!kind) return null;

  const copy = GUIDE_COPY[kind];
  const Icon = kind === "desktop" ? Monitor : kind === "ios" ? Share : Smartphone;

  return (
    <ClinicalCalmModal
      open={open}
      onClose={onClose}
      align="bottom"
      zIndexClass="z-[110]"
      labelledBy="pwa-install-guide-title"
      className="max-w-md rounded-2xl p-5"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2
            id="pwa-install-guide-title"
            className="flex items-center gap-2 text-lg font-semibold text-foreground"
          >
            <Icon className="h-5 w-5 text-primary" aria-hidden />
            {copy.title}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{copy.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Fechar guia de instalação"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {localDevHint ? (
        <p className="mb-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          Ambiente local: para ícone e sessão corretos, teste em{" "}
          <strong>localhost:3000</strong> ou rode{" "}
          <code className="rounded bg-warning/15 px-1">npm run pwa:test</code> com{" "}
          <code className="rounded bg-warning/15 px-1">
            NEXT_PUBLIC_ENABLE_PWA_INSTALL_DEV=1
          </code>
          .
        </p>
      ) : null}

      <ol className="space-y-3 text-sm text-foreground/90">
        {copy.steps.map((step, index) => (
          <li
            key={step}
            className="flex gap-3 rounded-xl border border-border bg-muted p-3 dark:bg-muted/60"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              {index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <Button type="button" className="flex-1" onClick={onClose}>
          Entendi
        </Button>
        <Button type="button" variant="outline" className="flex-1" asChild>
          <Link href={`/como-baixar-app${pwaInstallTutorialHash(copy.hashPlatform)}`}>
            Ver vídeo tutorial
          </Link>
        </Button>
      </div>
    </ClinicalCalmModal>
  );
}
