export type CrmPlaybookStep = {
  day: string;
  action: string;
  channel: "WHATSAPP" | "EMAIL" | "PHONE";
};

export type CrmPlaybook = {
  id: string;
  title: string;
  alertTypes: string[];
  goal: string;
  steps: CrmPlaybookStep[];
};

/** Playbooks mínimos Sprint B — roteiro de follow-up por tipo de alerta. */
export const CRM_PLAYBOOKS: CrmPlaybook[] = [
  {
    id: "cancel_retention",
    title: "Retenção — cancelamento agendado",
    alertTypes: ["CANCEL_SCHEDULED"],
    goal: "Entender o motivo e reverter antes do fim do período pago.",
    steps: [
      {
        day: "D0",
        action: "WhatsApp pessoal em até 4h: acolher + perguntar o que faltou.",
        channel: "WHATSAPP",
      },
      {
        day: "D2",
        action: "Se sem resposta: e-mail curto com 1 benefício concreto do plano.",
        channel: "EMAIL",
      },
      {
        day: "D5",
        action: "Oferecer ajuste (anual com desconto ou downgrade) se for custo.",
        channel: "WHATSAPP",
      },
      {
        day: "D-2 fim",
        action: "Último contato antes do period end; registrar outcome no CRM.",
        channel: "PHONE",
      },
    ],
  },
  {
    id: "inactive_paid",
    title: "Reativação — cliente pago inativo",
    alertTypes: ["INACTIVE_14D_PAID", "INACTIVE_10D", "USAGE_DROP_MOM"],
    goal: "Trazer de volta ao fluxo de evoluções em uma sessão curta.",
    steps: [
      {
        day: "D0",
        action: "Mensagem: 'sentimos sua falta' + oferta de call de 5 min.",
        channel: "WHATSAPP",
      },
      {
        day: "D3",
        action: "Enviar tip de voz (primeira evolução) se ainda inativo.",
        channel: "EMAIL",
      },
      {
        day: "D7",
        action: "Ligar se Premium/Consultório/Clínica; senão segundo WhatsApp.",
        channel: "PHONE",
      },
    ],
  },
  {
    id: "payment_recovery",
    title: "Recuperação — falha de pagamento",
    alertTypes: ["PAYMENT_FAILED"],
    goal: "Atualizar cartão em 24–48h (churn involuntário).",
    steps: [
      {
        day: "D0",
        action: "Enviar link do portal Stripe / atualização de pagamento.",
        channel: "WHATSAPP",
      },
      {
        day: "D1",
        action: "Se 2ª falha: mensagem direta + telefone se plano alto.",
        channel: "PHONE",
      },
      {
        day: "D3",
        action: "Confirmar se pagou; se não, oferecer parcelamento/anual.",
        channel: "WHATSAPP",
      },
    ],
  },
  {
    id: "upsell_engaged",
    title: "Upsell — trial/Básico engajado",
    alertTypes: ["TRIAL_ENGAGED_UPSELL", "PLAN_LIMIT_NEAR", "UPSELL_FINANCE"],
    goal: "Converter uso intenso em plano pago adequado.",
    steps: [
      {
        day: "D0",
        action: "Mostrar limite atingido / valor liberado no próximo plano.",
        channel: "WHATSAPP",
      },
      {
        day: "D2",
        action: "Oferecer cupom ou call de 10 min para escolher o plano.",
        channel: "WHATSAPP",
      },
    ],
  },
  {
    id: "renewal_touch",
    title: "Renovação próxima",
    alertTypes: ["RENEWAL_7D"],
    goal: "Confirmar satisfação e reduzir surpresa na cobrança.",
    steps: [
      {
        day: "D0",
        action: "E-mail: renovação em X dias + canal de suporte.",
        channel: "EMAIL",
      },
      {
        day: "D-3",
        action: "Se health baixo: WhatsApp proativo de check-in.",
        channel: "WHATSAPP",
      },
    ],
  },
];

export function playbooksForAlertTypes(alertTypes: string[]): CrmPlaybook[] {
  const set = new Set(alertTypes);
  return CRM_PLAYBOOKS.filter((p) => p.alertTypes.some((t) => set.has(t)));
}
