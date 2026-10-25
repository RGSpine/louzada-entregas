import {
  BASICO_AI_DOCUMENTS_PER_MONTH,
  effectivePlanForFeatures,
  getPlanLimits,
} from "@/lib/plan-limits";
import { normalizePlanTier } from "@/lib/plan-tier";
import type { PlanLimitKind } from "@/lib/plan-limit-upgrade";

/** Percentual de uso a partir do qual mostramos aviso preventivo (ex.: 18/20 evoluções). */
export const PLAN_USAGE_NEAR_LIMIT_RATIO = 0.85;

export type PlanUsageMetrics = {
  evolutionsUsedThisMonth: number;
  evolutionsLimit: number;
  patientsUsed: number;
  patientsLimit: number;
  documentsUsedThisMonth: number | null;
  documentsLimit: number | null;
};

export type PlanUsageWarning = {
  kind: PlanLimitKind;
  atLimit: boolean;
  used: number;
  limit: number;
  title: string;
  message: string;
};

/** Contagem mensal efetiva sem gravar reset lazy (só leitura para UI). */
export function effectiveMonthlyEvolutionCount(
  count: number,
  resetAt: Date | null | undefined,
  now = new Date(),
): number {
  if (
    !resetAt ||
    resetAt.getUTCMonth() !== now.getUTCMonth() ||
    resetAt.getUTCFullYear() !== now.getUTCFullYear()
  ) {
    return 0;
  }
  return count;
}

function formatCap(value: number): string {
  return Number.isFinite(value) ? String(value) : "ilimitado";
}

function buildWarning(
  kind: PlanLimitKind,
  used: number,
  limit: number,
  atLimit: boolean,
  label: string,
): PlanUsageWarning {
  const cap = formatCap(limit);
  if (atLimit) {
    return {
      kind,
      atLimit: true,
      used,
      limit,
      title: `Limite de ${label} atingido`,
      message: `Você usou ${used} de ${cap} ${label} do seu plano. Faça upgrade para continuar sem interrupções.`,
    };
  }
  return {
    kind,
    atLimit: false,
    used,
    limit,
    title: `Quase no limite de ${label}`,
    message: `Você já usou ${used} de ${cap} ${label} neste ciclo. Considere fazer upgrade antes de atingir o teto.`,
  };
}

/**
 * Avisos quando uso ≥ 85% ou limite esgotado.
 * Premium / Consultório / Clínica (limites Premium) não geram banner.
 */
export function getPlanUsageWarnings(
  plan: string | null | undefined,
  usage: PlanUsageMetrics,
  nearRatio = PLAN_USAGE_NEAR_LIMIT_RATIO,
): PlanUsageWarning[] {
  const featurePlan = effectivePlanForFeatures(plan, false);
  if (featurePlan === "PREMIUM") return [];

  const tier = normalizePlanTier(plan);
  if (!tier) return [];
  const limits = getPlanLimits(plan);
  const warnings: PlanUsageWarning[] = [];

  if (Number.isFinite(limits.maxEvolutions)) {
    const limit = limits.maxEvolutions;
    const used = usage.evolutionsUsedThisMonth;
    if (used >= limit) {
      warnings.push(buildWarning("evolutions", used, limit, true, "evoluções/mês"));
    } else if (used >= Math.ceil(limit * nearRatio)) {
      warnings.push(buildWarning("evolutions", used, limit, false, "evoluções/mês"));
    }
  }

  if (Number.isFinite(limits.maxPatients)) {
    const limit = limits.maxPatients;
    const used = usage.patientsUsed;
    if (used >= limit) {
      warnings.push(buildWarning("patients", used, limit, true, "pacientes"));
    } else if (used >= Math.ceil(limit * nearRatio)) {
      warnings.push(buildWarning("patients", used, limit, false, "pacientes"));
    }
  }

  if (
    tier === "BASICO" &&
    usage.documentsLimit != null &&
    usage.documentsUsedThisMonth != null
  ) {
    const limit = usage.documentsLimit ?? BASICO_AI_DOCUMENTS_PER_MONTH;
    const used = usage.documentsUsedThisMonth;
    if (used >= limit) {
      warnings.push(
        buildWarning("documents", used, limit, true, "documentos IA/mês"),
      );
    } else if (used >= Math.ceil(limit * nearRatio)) {
      warnings.push(
        buildWarning("documents", used, limit, false, "documentos IA/mês"),
      );
    }
  }

  return warnings;
}

export function isProFeaturePlanError(error: string | null | undefined): boolean {
  if (!error) return false;
  return /plano pro|disponível no plano pro|disponíveis no plano pro/i.test(error);
}

/** Erro de gate de plano pago (Starter ou Pro), ex.: agenda por áudio no FREE. */
export function isPremiumFeaturePlanError(error: string | null | undefined): boolean {
  if (!error) return false;
  if (isProFeaturePlanError(error)) return true;
  return /plano starter|disponível no plano starter|disponíveis no plano starter/i.test(error);
}
