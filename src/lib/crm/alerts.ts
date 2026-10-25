import type { CrmAccountSignals, CrmAlertDefinition } from "@/lib/crm/types";
import { generatesDirectRevenue, isPaidPlan } from "@/lib/crm/plan-pricing-cents";
import { getPlanLimits, type PlanType } from "@/lib/plan-limits";
import { normalizePlanTier } from "@/lib/plan-tier";
import { suggestUpgradeTarget } from "@/lib/crm/commercial-stage";

/** Tipos gerados por `buildCrmAlertsForAccount` — elegíveis a auto-resolve no sync. */
export const CRM_MANAGED_ALERT_TYPES = [
  "NO_FIRST_EVOLUTION_48H",
  "NO_PATIENT_7D",
  "TRIAL_ENGAGED_UPSELL",
  "PLAN_LIMIT_NEAR",
  "INACTIVE_10D",
  "INACTIVE_14D_PAID",
  "CANCEL_SCHEDULED",
  "PAYMENT_FAILED",
  "RENEWAL_7D",
  "RENEWAL_30D",
  "USAGE_DROP_MOM",
  "UPSELL_FINANCE",
] as const;

export type CrmManagedAlertType = (typeof CRM_MANAGED_ALERT_TYPES)[number];

function planLimitsForUser(plan: string | null | undefined): PlanType {
  const tier = normalizePlanTier(plan);
  if (!tier) return "BASICO";
  if (tier === "CONSULTORIO" || tier === "CLINICA") return "PREMIUM";
  if (tier === "PROFISSIONAL" || tier === "PREMIUM") return tier;
  return "BASICO";
}

function displayName(signals: CrmAccountSignals): string {
  return signals.name?.trim() || signals.email || "profissional";
}

export function buildCrmAlertsForAccount(signals: CrmAccountSignals): CrmAlertDefinition[] {
  const alerts: CrmAlertDefinition[] = [];
  const name = displayName(signals);
  const paid = generatesDirectRevenue(signals.plan, signals.isInfluencer);
  const onFreePlan = !isPaidPlan(signals.plan, signals.isInfluencer);
  const limits = getPlanLimits(planLimitsForUser(signals.plan));
  const days = signals.daysSinceActive;
  const signupDays = signals.daysSinceSignup;

  if (signupDays >= 2 && !signals.firstEvolutionAt) {
    alerts.push({
      alertType: "NO_FIRST_EVOLUTION_48H",
      severity: signupDays >= 7 ? "HIGH" : "MEDIUM",
      title: "Sem primeira evolução",
      message: `${name} cadastrou-se há ${signupDays} dia(s) e ainda não gravou uma evolução.`,
      suggestedChannel: "WHATSAPP",
      suggestedMessage: `Olá, ${name}! Vi que você criou sua conta no Louzada Entregas. Quer que eu te mostre em 2 minutos como gravar sua primeira evolução por voz?`,
    });
  }

  if (signupDays >= 7 && signals.patientCount === 0) {
    alerts.push({
      alertType: "NO_PATIENT_7D",
      severity: "MEDIUM",
      title: "Sem paciente cadastrado",
      message: `${name} está há ${signupDays} dias sem nenhum paciente no sistema.`,
      suggestedChannel: "WHATSAPP",
      suggestedMessage: `Oi, ${name}! Para aproveitar o Louzada Entregas, cadastre seu primeiro paciente — leva menos de 1 minuto. Posso te guiar?`,
    });
  }

  if (
    onFreePlan &&
    signals.totalEvolutions >= 5 &&
    signupDays >= 14
  ) {
    const target = suggestUpgradeTarget(normalizePlanTier(signals.plan));
    alerts.push({
      alertType: "TRIAL_ENGAGED_UPSELL",
      severity: "HIGH",
      title: "Trial engajado — oportunidade de upgrade",
      message: `${name} já fez ${signals.totalEvolutions} evoluções no Básico e não assinou há ${signupDays} dias.`,
      suggestedChannel: "WHATSAPP",
      suggestedMessage: `Olá, ${name}! Vi que você já usa o Louzada Entregas com frequência (${signals.totalEvolutions} evoluções). No plano ${target ?? "Profissional"}, você remove os limites e libera agenda + documentos. Quer ajuda para escolher?`,
      metadata: { suggestedPlan: target },
    });
  }

  const nearEvo =
    Number.isFinite(limits.maxEvolutions) &&
    signals.evolutionCount >= limits.maxEvolutions * 0.8;
  const nearPatients =
    Number.isFinite(limits.maxPatients) &&
    signals.patientCount >= limits.maxPatients * 0.8;

  if (onFreePlan && (nearEvo || nearPatients)) {
    alerts.push({
      alertType: "PLAN_LIMIT_NEAR",
      severity: "CRITICAL",
      title: "Próximo do limite do plano Básico",
      message: `${name} está perto do limite (${signals.evolutionCount} evoluções/mês, ${signals.patientCount} pacientes).`,
      suggestedChannel: "WHATSAPP",
      suggestedMessage: `Oi, ${name}! Você está quase no limite do plano Básico. Posso te ajudar a migrar para o Profissional sem perder nada do que já cadastrou?`,
      metadata: {
        evolutionCount: signals.evolutionCount,
        patientCount: signals.patientCount,
      },
    });
  }

  if (days !== null && days >= 10 && days < 14) {
    alerts.push({
      alertType: "INACTIVE_10D",
      severity: "MEDIUM",
      title: "Inatividade 10+ dias",
      message: `${name} sem atividade há ${days} dias.`,
      suggestedChannel: "EMAIL",
      suggestedMessage: `Olá, ${name}! Sentimos sua falta no Louzada Entregas. Teve alguma dificuldade na última evolução ou na agenda? Estamos aqui para ajudar.`,
    });
  }

  if (paid && days !== null && days >= 14) {
    alerts.push({
      alertType: "INACTIVE_14D_PAID",
      severity: "CRITICAL",
      title: "Cliente pago inativo",
      message: `${name} (plano ${signals.plan}) sem uso há ${days} dias — alto risco de churn.`,
      suggestedChannel: "WHATSAPP",
      suggestedMessage: `Oi, ${name}! Notei que faz um tempo que você não usa o Louzada Entregas. Aconteceu algo? Posso te ajudar a retomar o fluxo de evoluções em 5 minutos.`,
    });
  }

  if (signals.stripeCancelAtPeriodEnd && paid) {
    const endLabel = signals.currentPeriodEnd
      ? signals.currentPeriodEnd.toLocaleDateString("pt-BR")
      : "o fim do período";
    alerts.push({
      alertType: "CANCEL_SCHEDULED",
      severity: "CRITICAL",
      title: "Cancelamento de plano agendado",
      message: `${name} pediu cancelamento. Acesso até ${endLabel}. Follow-up de retenção.`,
      suggestedChannel: "WHATSAPP",
      suggestedMessage: `Oi, ${name}! Vi que você solicitou o cancelamento do Louzada Entregas. Antes de encerrar, posso entender o que faltou pra você e ver se há como ajustar?`,
      metadata: {
        currentPeriodEnd: signals.currentPeriodEnd?.toISOString() ?? null,
      },
    });
  }

  if (signals.recentPaymentFailure && paid) {
    alerts.push({
      alertType: "PAYMENT_FAILED",
      severity: "CRITICAL",
      title: "Falha de pagamento Stripe",
      message: `${name} tem falha de cobrança em aberto — churn involuntário.`,
      suggestedChannel: "WHATSAPP",
      suggestedMessage: `Oi, ${name}! Notamos uma falha no pagamento da sua assinatura do Louzada Entregas. Posso te enviar o link para atualizar o cartão?`,
    });
  }

  if (
    paid &&
    signals.evolutionsPrev30Days >= 3 &&
    signals.evolutionsLast30Days / signals.evolutionsPrev30Days < 0.7
  ) {
    const dropPct = Math.round(
      (1 - signals.evolutionsLast30Days / signals.evolutionsPrev30Days) * 100,
    );
    alerts.push({
      alertType: "USAGE_DROP_MOM",
      severity: "HIGH",
      title: "Queda de uso mês a mês",
      message: `${name}: evoluções caíram ~${dropPct}% vs. os 30 dias anteriores (${signals.evolutionsLast30Days} vs ${signals.evolutionsPrev30Days}).`,
      suggestedChannel: "WHATSAPP",
      suggestedMessage: `Oi, ${name}! Vi que o ritmo de evoluções diminuiu neste mês. Posso ajudar a retomar o fluxo em 5 minutos?`,
      metadata: {
        evolutionsLast30Days: signals.evolutionsLast30Days,
        evolutionsPrev30Days: signals.evolutionsPrev30Days,
      },
    });
  }

  const msToEnd = signals.currentPeriodEnd
    ? signals.currentPeriodEnd.getTime() - Date.now()
    : null;
  const renewingSoon =
    msToEnd != null &&
    msToEnd > 0 &&
    paid &&
    !signals.stripeCancelAtPeriodEnd;

  if (renewingSoon && msToEnd! <= 7 * 24 * 60 * 60 * 1000) {
    const renewalDate = signals.currentPeriodEnd!.toLocaleDateString("pt-BR");
    alerts.push({
      alertType: "RENEWAL_7D",
      severity: "MEDIUM",
      title: "Renovação em 7 dias",
      message: `Assinatura de ${name} renova em ${renewalDate}.`,
      suggestedChannel: "EMAIL",
      suggestedMessage: `Olá, ${name}! Sua assinatura do Louzada Entregas renova em ${renewalDate}. Quer manter o plano ${signals.plan} ou conversar sobre outra opção?`,
      metadata: { renewalDate },
    });
  } else if (
    renewingSoon &&
    msToEnd! <= 30 * 24 * 60 * 60 * 1000
  ) {
    const renewalDate = signals.currentPeriodEnd!.toLocaleDateString("pt-BR");
    alerts.push({
      alertType: "RENEWAL_30D",
      severity: "LOW",
      title: "Renovação em 30 dias",
      message: `Assinatura de ${name} renova em ${renewalDate}.`,
      suggestedChannel: "EMAIL",
      suggestedMessage: `Olá, ${name}! Sua renovação do Louzada Entregas está próxima (${renewalDate}). Tudo certo com o plano ${signals.plan}?`,
      metadata: { renewalDate },
    });
  }

  if (
    paid &&
    signals.features.agenda &&
    !signals.features.finance &&
    signals.evolutionsLast30Days >= 3
  ) {
    alerts.push({
      alertType: "UPSELL_FINANCE",
      severity: "LOW",
      title: "Upsell — financeiro",
      message: `${name} usa agenda e evoluções, mas ainda não registrou movimentação no financeiro.`,
      suggestedChannel: "WHATSAPP",
      suggestedMessage: `Oi, ${name}! Você já usa agenda e evoluções. Sabia que pode registrar entradas falando "recebi R$200 da Maria" no consultório financeiro? Quer ver como funciona?`,
    });
  }

  return alerts;
}
