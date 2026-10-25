import { ESTER_AGENT_NAME, ESTER_UPSELL_DESCRIPTION } from "@/lib/clinical-chat/ester-branding";

export type PremiumFeatureId =
  | "clinical-chat"
  | "office-finance"
  | "voice-agenda"
  | "agenda-reports"
  | "finance-assistant"
  | "goals"
  | "clinical-insights"
  | "visual-evolution"
  | "exam-folder-upload"
  | "priority-support"
  | "yield-management";

export type PremiumRequiredPlan = "PROFISSIONAL" | "PREMIUM";

export type PremiumFeatureDef = {
  requiredPlan: PremiumRequiredPlan;
  title: string;
  description: string;
};

export const PREMIUM_FEATURES: Record<PremiumFeatureId, PremiumFeatureDef> = {
  "clinical-chat": {
    requiredPlan: "PREMIUM",
    title: ESTER_AGENT_NAME,
    description: ESTER_UPSELL_DESCRIPTION,
  },
  "office-finance": {
    requiredPlan: "PREMIUM",
    title: "Financeiro",
    description:
      "Catálogo de valores das próteses, caixa das entregas e exportação fiscal. Coletas e entregas ficam na agenda.",
  },
  "voice-agenda": {
    requiredPlan: "PROFISSIONAL",
    title: "Agenda por áudio",
    description: "Marque, remarque ou desmarque consultas por voz — a IA organiza na sua agenda.",
  },
  "agenda-reports": {
    requiredPlan: "PREMIUM",
    title: "Relatórios da agenda",
    description: "Pergunte por voz ou texto quantos pacientes você tem amanhã, na semana ou no feriado.",
  },
  "finance-assistant": {
    requiredPlan: "PREMIUM",
    title: "Assistente financeiro",
    description: "Registre entradas e despesas por texto, áudio ou comprovante com IA.",
  },
  "goals": {
    requiredPlan: "PROFISSIONAL",
    title: "Metas de volume",
    description: "Defina metas semanais e mensais de atendimentos e acompanhe seu progresso.",
  },
  "clinical-insights": {
    requiredPlan: "PROFISSIONAL",
    title: "Perfil clínico avançado",
    description: "Insights de atuação, tags frequentes e estatísticas clínicas detalhadas.",
  },
  "visual-evolution": {
    requiredPlan: "PROFISSIONAL",
    title: "Evolução visual",
    description: "Gráficos gamificados do progresso do paciente para compartilhar ou acompanhar.",
  },
  "exam-folder-upload": {
    requiredPlan: "PREMIUM",
    title: "Upload na pasta de exames",
    description: "Anexe PDFs e imagens manualmente na pasta de exames de cada paciente.",
  },
  "priority-support": {
    requiredPlan: "PREMIUM",
    title: "Suporte prioritário",
    description: "Atendimento via WhatsApp com resposta em até 24 horas úteis.",
  },
  "yield-management": {
    requiredPlan: "PREMIUM",
    title: "Gestão Inteligente",
    description:
      "Publique horários ociosos no marketplace com desconto automático para pacientes próximos.",
  },
};

export function premiumFeatureUpsellPath(featureId: PremiumFeatureId): string {
  return `/dashboard/upgrade?feature=${featureId}`;
}

export function parsePremiumFeatureId(raw: string | null | undefined): PremiumFeatureId | null {
  if (!raw) return null;
  return raw in PREMIUM_FEATURES ? (raw as PremiumFeatureId) : null;
}

export function premiumPlanLabel(requiredPlan: PremiumRequiredPlan): string {
  return requiredPlan === "PREMIUM" ? "Premium" : "Profissional e Premium";
}

export function premiumAvailabilityMessage(requiredPlan: PremiumRequiredPlan): string {
  return requiredPlan === "PREMIUM"
    ? "Disponível no plano Premium."
    : "Disponível nos planos Profissional e Premium.";
}

export function premiumFeatureUpsellMessage(featureId: PremiumFeatureId): string {
  const feature = PREMIUM_FEATURES[featureId];
  return `${feature.description} ${premiumAvailabilityMessage(feature.requiredPlan)}`;
}
