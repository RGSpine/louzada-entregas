"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ClinicalCalmModal } from "@/components/ui/ClinicalCalmModal";
import { Sparkles, X } from "lucide-react";

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  message?: string;
  upgradeLabel?: string;
}

const DEFAULT_TITLE = "Recurso exclusivo";
const DEFAULT_MESSAGE =
  "Este recurso está disponível em planos pagos. Faça upgrade para continuar aproveitando ao máximo o Louzada Entregas.";

export function UpgradeModal({
  open,
  onClose,
  title = DEFAULT_TITLE,
  message = DEFAULT_MESSAGE,
  upgradeLabel = "Ver planos e fazer upgrade",
}: UpgradeModalProps) {
  return (
    <ClinicalCalmModal open={open} onClose={onClose} labelledBy="upgrade-modal-title">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-success/15 p-2 text-success">
            <Sparkles className="h-5 w-5" />
          </div>
          <h2 id="upgrade-modal-title" className="text-lg font-semibold text-foreground">
            {title}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Fechar"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">{message}</p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link href="/dashboard/planos" className="flex-1">
          <Button variant="clinical" className="w-full">
            {upgradeLabel}
          </Button>
        </Link>
        <Button variant="outline" onClick={onClose} className="sm:w-auto">
          Fechar
        </Button>
      </div>
    </ClinicalCalmModal>
  );
}
