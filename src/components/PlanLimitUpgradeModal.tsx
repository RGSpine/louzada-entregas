"use client";

import { UpgradeModal } from "@/components/UpgradeModal";
import {
  getPlanLimitUpgradeCopy,
  type PlanLimitKind,
} from "@/lib/plan-limit-upgrade";
import type { PlanTier } from "@/lib/plan-tier";

type Props = {
  open: boolean;
  onClose: () => void;
  kind: PlanLimitKind | null;
  currentPlan: PlanTier | string;
  audioSeconds?: number;
  pdfGenerated?: boolean;
};

export function PlanLimitUpgradeModal({
  open,
  onClose,
  kind,
  currentPlan,
  audioSeconds,
  pdfGenerated,
}: Props) {
  if (!kind) return null;

  const copy = getPlanLimitUpgradeCopy(kind, currentPlan, {
    audioSeconds,
    pdfGenerated,
  });

  return (
    <UpgradeModal
      open={open}
      onClose={onClose}
      title={copy.title}
      message={copy.message}
      upgradeLabel="Ver planos e fazer upgrade"
    />
  );
}
