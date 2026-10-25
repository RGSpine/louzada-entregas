"use client";

import { useState } from "react";
import { FolderInput } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PatientHistoryImportPanel } from "@/components/dashboard/PatientHistoryImportPanel";
import { PlanLimitUpgradeModal } from "@/components/PlanLimitUpgradeModal";
import type { PlanLimitKind } from "@/lib/plan-limit-upgrade";

type SharedProps = {
  patientId: string;
  patientName: string;
  userPlan: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onAttached: () => void;
};

/** Botão da ficha — abre o painel de importar evoluções avulsas/em lote. */
export function PatientFichaHistoryImportButton({
  onClick,
}: {
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className="h-auto w-full gap-2 whitespace-normal px-3 py-2.5 text-left text-sm font-semibold leading-tight sm:w-auto sm:min-w-[11rem] sm:text-center"
      onClick={onClick}
    >
      <FolderInput className="h-4 w-4 shrink-0" />
      Importar evoluções
    </Button>
  );
}

/** Painel + modal de cota, para a aba Histórico da ficha. */
export function PatientFichaHistoryImport({
  patientId,
  patientName,
  userPlan,
  enabled,
  onEnabledChange,
  onAttached,
}: SharedProps) {
  const [upgradeLimitKind, setUpgradeLimitKind] = useState<PlanLimitKind | null>(null);

  return (
    <>
      <PatientHistoryImportPanel
        variant="attach"
        patientId={patientId}
        patientName={patientName}
        enabled={enabled}
        onEnabledChange={onEnabledChange}
        onPlanLimitHit={(kind) => setUpgradeLimitKind(kind)}
        onAttached={onAttached}
      />
      <PlanLimitUpgradeModal
        open={upgradeLimitKind !== null}
        onClose={() => setUpgradeLimitKind(null)}
        kind={upgradeLimitKind}
        currentPlan={userPlan}
      />
    </>
  );
}
