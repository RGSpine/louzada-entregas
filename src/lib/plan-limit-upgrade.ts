import {
  BASICO_AI_DOCUMENTS_PER_MONTH,
  HISTORY_IMPORTS_PER_MONTH,
  effectivePlanForFeatures,
  formatAudioLimitPhrase,
  formatAudioLimitPhraseFromSeconds,
  getPlanLimits,
  type PlanType,
} from "@/lib/plan-limits";
import { planDisplayName, type PlanTier } from "@/lib/plan-tier";

export type PlanLimitKind =
  | "evolutions"
  | "patients"
  | "audio"
  | "documents"
  | "historyImports";

export type PlanLimitUpgradeCopy = {
  title: string;
  message: string;
  /** Plano sugerido no CTA (FREE → Starter; Starter → Pro). */
  targetPlan: "PROFISSIONAL" | "PREMIUM";
};

/** Bucket de limites (BASICO/PROFISSIONAL/PREMIUM) a partir do tier comercial. */
function limitsBucket(plan: PlanTier | PlanType | string): PlanType {
  return effectivePlanForFeatures(plan, false);
}

/** Básico → Profissional; demais (incl. equipe) → Premium. */
export function suggestedUpgradePlan(
  currentPlan: PlanTier | PlanType | string,
): "PROFISSIONAL" | "PREMIUM" {
  return limitsBucket(currentPlan) === "BASICO" ? "PROFISSIONAL" : "PREMIUM";
}

function targetPlanLabel(target: "PROFISSIONAL" | "PREMIUM"): string {
  return target === "PROFISSIONAL" ? "Profissional" : "Premium";
}

function currentPlanLabel(currentPlan: PlanTier | PlanType | string): string {
  return planDisplayName(currentPlan);
}

function formatMonthlyCap(value: number): string {
  if (!Number.isFinite(value)) return "ilimitadas";
  return String(value);
}

export function detectPlanLimitKindFromError(error: string): PlanLimitKind | null {
  const normalized = error.toLowerCase();
  if (normalized.includes("importa")) return "historyImports";
  if (normalized.includes("evolu")) return "evolutions";
  if (normalized.includes("paciente")) return "patients";
  if (normalized.includes("documento")) return "documents";
  if (normalized.includes("grava") || normalized.includes("áudio") || normalized.includes("audio")) {
    return "audio";
  }
  return null;
}

export function planLimitErrorTriggersUpgrade(error: string): boolean {
  return detectPlanLimitKindFromError(error) !== null;
}

type CopyOptions = {
  /** Segundos máximos de áudio do plano atual (para mensagem de gravação). */
  audioSeconds?: number;
  /** PDF já gerado mas histórico não salvo (fluxo de evolução). */
  pdfGenerated?: boolean;
};

export function getPlanLimitUpgradeCopy(
  kind: PlanLimitKind,
  currentPlan: PlanTier | PlanType | string,
  options: CopyOptions = {},
): PlanLimitUpgradeCopy {
  const target = suggestedUpgradePlan(currentPlan);
  const targetLabel = targetPlanLabel(target);
  const fromLabel = currentPlanLabel(currentPlan);
  const currentLimits = getPlanLimits(currentPlan);
  const targetLimits = getPlanLimits(target);
  const currentBucket = limitsBucket(currentPlan);
  const targetBucket = limitsBucket(target);

  const upgradeInvite = `Faça upgrade para o plano ${targetLabel} e continue sem interrupções.`;

  switch (kind) {
    case "evolutions": {
      const cap = formatMonthlyCap(currentLimits.maxEvolutions);
      const nextCap = formatMonthlyCap(targetLimits.maxEvolutions);
      const pdfNote = options.pdfGenerated
        ? " O PDF foi gerado, mas a evolução não foi salva no histórico."
        : "";
      return {
        title: "Limite de evoluções atingido",
        message: `Você atingiu o limite de ${cap} evoluções por mês do plano ${fromLabel}.${pdfNote} No ${targetLabel}, você passa a ter até ${nextCap} evoluções por mês. ${upgradeInvite}`,
        targetPlan: target,
      };
    }
    case "patients": {
      const cap = formatMonthlyCap(currentLimits.maxPatients);
      const nextCap = formatMonthlyCap(targetLimits.maxPatients);
      const pdfNote = options.pdfGenerated
        ? " O PDF foi gerado, mas o paciente não pôde ser cadastrado."
        : "";
      return {
        title: "Limite de pacientes atingido",
        message: `Você atingiu o limite de ${cap} pacientes do plano ${fromLabel}.${pdfNote} No ${targetLabel}, você pode cadastrar até ${nextCap} pacientes. ${upgradeInvite}`,
        targetPlan: target,
      };
    }
    case "audio": {
      const currentPhrase =
        options.audioSeconds !== undefined
          ? formatAudioLimitPhraseFromSeconds(options.audioSeconds)
          : formatAudioLimitPhrase(currentLimits.maxAudioMinutes);
      const nextPhrase = formatAudioLimitPhrase(targetLimits.maxAudioMinutes);
      return {
        title: "Limite de gravação atingido",
        message: `Seu plano ${fromLabel} permite até ${currentPhrase} de áudio por gravação. No ${targetLabel}, você pode gravar até ${nextPhrase} por evolução. ${upgradeInvite}`,
        targetPlan: target,
      };
    }
    case "historyImports": {
      const cap = formatMonthlyCap(HISTORY_IMPORTS_PER_MONTH[currentBucket]);
      const nextCap = formatMonthlyCap(HISTORY_IMPORTS_PER_MONTH[targetBucket]);
      return {
        title: "Limite de importações de histórico atingido",
        message: `Você atingiu o limite de ${cap} importações de histórico por mês no plano ${fromLabel}. No ${targetLabel}, você passa a ter até ${nextCap} importações/mês (independente das evoluções novas). ${upgradeInvite}`,
        targetPlan: target,
      };
    }
    case "documents":
    default: {
      return {
        title: "Limite de documentos atingido",
        message: `Você atingiu o limite de ${BASICO_AI_DOCUMENTS_PER_MONTH} documentos gerados por IA por mês no plano Básico. No ${targetLabel}, a geração de documentos clínicos por IA fica ilimitada. ${upgradeInvite}`,
        targetPlan: target,
      };
    }
  }
}
