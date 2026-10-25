"use client";

import { RecurringExpensesPanel } from "@/components/dashboard/finances/RecurringExpensesPanel";
import { VariableExpensesPanel } from "@/components/dashboard/finances/VariableExpensesPanel";
import { ServiceSpacesConfigPanel } from "@/components/dashboard/finances/ServiceSpacesConfigPanel";
import { financeOutlineBtnClass } from "./finance-outline-btn";

export function FinanceConfigurePanel({
  financePlan,
  onRecurringChanged,
  canUseServiceSpaces = false,
}: {
  financePlan: {
    maxAudioMinutes: number;
    officeFinanceAllowsImageUpload: boolean;
  } | null;
  onRecurringChanged: () => void;
  canUseServiceSpaces?: boolean;
}) {
  return (
    <div className="space-y-6">
      <ServiceSpacesConfigPanel enabled={canUseServiceSpaces} />
      <RecurringExpensesPanel
        allowImageUpload={financePlan?.officeFinanceAllowsImageUpload ?? false}
        maxAudioMinutes={financePlan?.maxAudioMinutes ?? 120}
        outlineBtnClass={financeOutlineBtnClass}
        onChanged={onRecurringChanged}
      />
      <VariableExpensesPanel
        allowImageUpload={financePlan?.officeFinanceAllowsImageUpload ?? false}
        maxAudioMinutes={financePlan?.maxAudioMinutes ?? 120}
        outlineBtnClass={financeOutlineBtnClass}
        onChanged={onRecurringChanged}
      />
    </div>
  );
}
