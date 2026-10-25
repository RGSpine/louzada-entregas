import assert from "node:assert/strict";
import type { CrmPlanChangeReason } from "@prisma/client";

/**
 * Espelha a regra de SAME_PLAN_ALLOWED em recordCrmPlanChange
 * (sem bater no Prisma).
 */
function shouldRecordSamePlanChange(
  fromLabel: string,
  toLabel: string,
  reason: CrmPlanChangeReason,
): boolean {
  const SAME_PLAN_ALLOWED: CrmPlanChangeReason[] = [
    "CANCEL_SCHEDULED",
    "COUPON",
    "ADMIN_ADJUSTMENT",
    "UNKNOWN",
  ];
  if (fromLabel === toLabel && !SAME_PLAN_ALLOWED.includes(reason)) {
    return false;
  }
  return true;
}

assert.equal(
  shouldRecordSamePlanChange("PREMIUM", "PREMIUM", "CANCEL_SCHEDULED"),
  true,
  "cancel agendado deve gravar com mesmo plano",
);
assert.equal(
  shouldRecordSamePlanChange("PREMIUM", "PREMIUM", "UPGRADE_USAGE"),
  false,
  "upgrade sem mudança de plano não grava",
);
assert.equal(
  shouldRecordSamePlanChange("BASICO", "PROFISSIONAL", "UPGRADE_USAGE"),
  true,
);

console.log("crm record-plan-change tests ok");
