import type { PlanTier } from "@/lib/plan-tier";
import { isIncompletePlan } from "@/lib/plan-tier";

/**
 * Cupom só no cadastro (escolha do plano) ou no primeiro upgrade a partir de incompleto.
 * Starter→Pro, downgrades e re-assinaturas não usam cupom.
 */
export function canUseCheckoutCoupon(
  currentPlan: PlanTier | null | undefined,
  fromSignupOrNeedsCheckout = false,
): boolean {
  if (fromSignupOrNeedsCheckout) return true;
  if (isIncompletePlan(currentPlan)) return true;
  if (
    currentPlan === "PROFISSIONAL" ||
    currentPlan === "PREMIUM" ||
    currentPlan === "CONSULTORIO" ||
    currentPlan === "CLINICA"
  ) {
    return false;
  }
  // Básico pago já ativo: cupom só no primeiro checkout (tratado via fromSignup).
  return false;
}
