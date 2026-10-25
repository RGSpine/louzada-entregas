import {
  formatAudioLimitLabel,
  getPlanLimits,
  type PlanLimits,
  BASICO_AI_DOCUMENTS_PER_MONTH,
  HISTORY_IMPORTS_PER_MONTH,
} from "@/lib/plan-limits";
import { PRO_PRIORITY_SUPPORT_SLA_LABEL } from "@/lib/pro-priority-support";

export const PRICING = {
  BASICO: { monthly: "18,90", annualPerMonth: "15,12", annualTotal: "181,44" },
  PROFISSIONAL: { monthly: "49,90", annualPerMonth: "39,90", annualTotal: "478,80" },
  PREMIUM: { monthly: "87,90", annualPerMonth: "69,90", annualTotal: "838,80" },
  CONSULTORIO: { monthly: "159,80", annualPerMonth: "127,84", annualTotal: "1.534,08" },
  CLINICA: { monthly: "273,70", annualPerMonth: "218,96", annualTotal: "2.627,52" },
} as const;

export function formatLimit(value: number): string {
  return value === Infinity ? "Ilimitado" : String(value);
}

/** Benefícios exibidos nos cards do plano Básico (valores numéricos vêm de `plan-limits`). */
export function basicoPlanFeatures(limits: PlanLimits): string[] {
  return [
    `Até ${formatAudioLimitLabel(limits.maxAudioMinutes)} de áudio por evolução`,
    `${formatLimit(limits.maxEvolutions)} evoluções/mês`,
    `${formatLimit(limits.maxPatients)} pacientes`,
    "Áudio, texto e upload de exames/fotos na evolução",
    "Lista de pacientes e resumo clínico básico",
    "Organização manual de pacientes",
    "Estatísticas básicas (totais, períodos, médias)",
    "Exportação em PDF simples",
    `Aba Exames/Documentos no paciente; até ${BASICO_AI_DOCUMENTS_PER_MONTH} documentos gerados por IA/mês (UTC)`,
    `Até ${HISTORY_IMPORTS_PER_MONTH.BASICO} importações de histórico de outra plataforma/mês`,
    "14 dias de teste grátis ao assinar",
  ];
}

/** @deprecated Alias — use basicoPlanFeatures */
export const freePlanFeatures = basicoPlanFeatures;

export function starterPlanFeatures(limits: PlanLimits): string[] {
  return [
    `Até ${formatAudioLimitLabel(limits.maxAudioMinutes)} de áudio por evolução`,
    `${formatLimit(limits.maxEvolutions)} evoluções/mês`,
    `${formatLimit(limits.maxPatients)} pacientes`,
    "Áudio, texto e upload de exames/fotos na evolução",
    "Perfil Clínico detalhado na aba do paciente",
    "Alerta de homônimos e pacientes parecidos",
    "Estatísticas avançadas, perfil de atuação e metas",
    "Evolução Visual (compartilhamento gráfico gamificado)",
    "Documentos gerados por IA ilimitados (aba Exames/Documentos)",
    "Agenda semanal com agendamento por áudio ou foto",
    "Cores de confirmação na agenda (amarelo/verde)",
    "Gerar marcações em lote a partir de tratamento/plano (financeiro)",
    "Projeção financeira da semana na agenda (consultas vs. plano)",
    `Até ${HISTORY_IMPORTS_PER_MONTH.PROFISSIONAL} importações de histórico de outra plataforma/mês`,
    "14 dias de teste grátis ao assinar",
  ];
}

export function proPlanFeatures(limits: PlanLimits): string[] {
  return [
    `Até ${formatAudioLimitLabel(limits.maxAudioMinutes)} de áudio por evolução`,
    `${formatLimit(limits.maxEvolutions)} evoluções/mês`,
    `${formatLimit(limits.maxPatients)} pacientes`,
    "Tudo do plano Profissional (inclui Evolução Visual, metas e alertas)",
    "Upload manual na Pasta de Exames (PDF/imagem por paciente), além dos documentos por IA",
    "Relatórios da agenda por voz ou texto (ex.: quantos pacientes amanhã)",
    "Consultório financeiro (catálogo, caixa, relatórios e assistente com IA)",
    `Suporte prioritário via WhatsApp (resposta ${PRO_PRIORITY_SUPPORT_SLA_LABEL})`,
    "Importações ilimitadas de histórico de outra plataforma",
    "14 dias de teste grátis ao assinar",
  ];
}

export function starterClinicaPlanFeatures(limits: PlanLimits): string[] {
  return [
    ...proPlanFeatures(limits),
    "Até 5 acessos simultâneos (equipe da clínica)",
  ];
}

export function proClinicaPlanFeatures(limits: PlanLimits): string[] {
  return [
    ...proPlanFeatures(limits),
    "Até 10 acessos simultâneos (equipe da clínica)",
  ];
}

export { getPlanLimits };
