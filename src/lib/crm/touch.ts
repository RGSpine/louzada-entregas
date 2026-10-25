import { recordCrmPlanChange, syncCrmAccount } from "@/lib/crm/sync-account";
import type { CrmPlanChangeReason } from "@prisma/client";

/** Atualização leve após atividade no produto (não bloqueia o fluxo principal). */
export function scheduleCrmAccountSync(userId: string) {
  void syncCrmAccount(userId).catch((err) => {
    console.error("[crm] syncCrmAccount failed:", userId, err);
  });
}

export function scheduleCrmPlanChange(input: {
  userId: string;
  fromPlan: string;
  toPlan: string;
  reason?: CrmPlanChangeReason;
  reasonNote?: string;
  source?: string;
  stripeEventId?: string;
}) {
  void recordCrmPlanChange(input).catch((err) => {
    console.error("[crm] recordCrmPlanChange failed:", input.userId, err);
  });
}
