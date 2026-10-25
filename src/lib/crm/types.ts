import type {
  CrmAlertChannel,
  CrmAlertSeverity,
  CrmAlertStatus,
  CrmAhaMomentType,
  CrmChurnRisk,
  CrmCommercialStage,
  CrmConversationChannel,
  CrmPlanChangeReason,
  CrmSatisfactionType,
} from "@prisma/client";

export type CrmFeaturesActivated = {
  evolution: boolean;
  patients: boolean;
  agenda: boolean;
  finance: boolean;
  chat: boolean;
  documents: boolean;
  googleCalendar: boolean;
};

export const CRM_FEATURE_LABELS: Record<keyof CrmFeaturesActivated, string> = {
  evolution: "Evolução por voz/texto",
  patients: "Pacientes cadastrados",
  agenda: "Agenda Profissional",
  finance: "Consultório financeiro",
  chat: "Ester — agente clínica de pesquisa",
  documents: "Documentos / exames",
  googleCalendar: "Google Agenda sync",
};

export const CRM_STAGE_LABELS: Record<CrmCommercialStage, string> = {
  TRIAL_ACTIVE: "Trial ativo",
  ENGAGED: "Engajado",
  OPPORTUNITY: "Oportunidade",
  CUSTOMER_PAID: "Cliente pago",
  AT_RISK: "Em risco",
  CHURNED: "Churn",
  INFLUENCER: "Influencer",
};

export const CRM_CHURN_LABELS: Record<CrmChurnRisk, string> = {
  LOW: "Baixo",
  MEDIUM: "Médio",
  HIGH: "Alto",
  CRITICAL: "Crítico",
};

export const CRM_PLAN_CHANGE_LABELS: Record<CrmPlanChangeReason, string> = {
  UPGRADE_USAGE: "Upgrade por uso",
  DOWNGRADE_COST: "Downgrade por custo",
  CHURN_VOLUNTARY: "Cancelamento voluntário",
  CHURN_PAYMENT_FAILED: "Falha de pagamento",
  CANCEL_SCHEDULED: "Cancelamento agendado",
  INFLUENCER_GRANT: "Parceria influencer",
  ADMIN_ADJUSTMENT: "Ajuste admin",
  COUPON: "Cupom promocional",
  UNKNOWN: "Não informado",
};

export const CRM_SATISFACTION_LABELS: Record<CrmSatisfactionType, string> = {
  NPS_D7: "NPS — 7 dias",
  NPS_D30: "NPS — 30 dias",
  NPS_D90: "NPS — 90 dias",
  CSAT_SUPPORT: "CSAT suporte",
  CSAT_ONBOARDING: "CSAT onboarding",
};

export const CRM_ALERT_STATUS_LABELS: Record<CrmAlertStatus, string> = {
  OPEN: "Aberto",
  ACKNOWLEDGED: "Em andamento",
  RESOLVED: "Resolvido",
  DISMISSED: "Dispensado",
};

export const CRM_ALERT_SEVERITY_LABELS: Record<CrmAlertSeverity, string> = {
  LOW: "Baixa",
  MEDIUM: "Média",
  HIGH: "Alta",
  CRITICAL: "Crítica",
};

export const CRM_ALERT_CHANNEL_LABELS: Record<CrmAlertChannel, string> = {
  IN_APP: "In-app",
  EMAIL: "E-mail",
  WHATSAPP: "WhatsApp",
};

export const CRM_CONVERSATION_CHANNEL_LABELS: Record<CrmConversationChannel, string> = {
  WHATSAPP: "WhatsApp",
  EMAIL: "E-mail",
  INSTAGRAM: "Instagram",
  PHONE: "Telefone",
  IN_APP: "In-app",
};

export type CrmAccountSignals = {
  userId: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  profession: string | null;
  plan: string | null;
  planInterval: string | null;
  isInfluencer: boolean;
  createdAt: Date;
  currentPeriodEnd: Date | null;
  /** Stripe cancel_at_period_end — cancelamento pedido, ainda ativo. */
  stripeCancelAtPeriodEnd: boolean;
  /** Alerta PAYMENT_FAILED aberto (invoice.payment_failed). */
  recentPaymentFailure: boolean;
  evolutionCount: number;
  patientCount: number;
  googleCalendarLastSyncedAt: Date | null;
  daysSinceSignup: number;
  daysSinceActive: number | null;
  evolutionsLast30Days: number;
  /** Evoluções no período 30–60 dias atrás (para tendência MoM). */
  evolutionsPrev30Days: number;
  totalEvolutions: number;
  features: CrmFeaturesActivated;
  firstEvolutionAt: Date | null;
  firstPatientAt: Date | null;
  firstAgendaAt: Date | null;
  firstFinanceAt: Date | null;
  firstChatAt: Date | null;
  firstDocumentAt: Date | null;
  lastActiveAt: Date | null;
  paidSinceAt: Date | null;
};

export type CrmHealthBreakdown = {
  recency: number;
  frequency: number;
  /** Tendência MoM de evoluções (0–20). */
  usageTrend: number;
  breadth: number;
  planFit: number;
  /** Saúde de pagamento Stripe (0–10). */
  paymentHealth: number;
  total: number;
};

export type CrmAlertDefinition = {
  alertType: string;
  severity: CrmAlertSeverity;
  title: string;
  message: string;
  suggestedChannel: CrmAlertChannel;
  suggestedMessage: string;
  metadata?: Record<string, unknown>;
};

export type CrmAhaMomentCandidate = {
  type: CrmAhaMomentType;
  at: Date;
};
