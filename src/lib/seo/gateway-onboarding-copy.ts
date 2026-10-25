/**
 * Copy do onboarding vertical da home-gateway (`/`).
 * Benefícios do profissional espelham a landing `/profissional` (sem apagar a origem).
 */

export const GATEWAY_PRO = {
  eyebrow: "Para profissionais",
  title: "Automatize o consultório sem perder o controle clínico",
  lead: "Grave o áudio da consulta e receba evoluções, agenda e financeiro organizados — com você validando cada etapa.",
  benefits: [
    {
      title: "Documentação estruturada",
      text: "Resumo e evolução organizados para revisar e usar no dia a dia.",
    },
    {
      title: "Fluxo mais rápido",
      text: "Menos digitação repetitiva entre uma consulta e outra.",
    },
    {
      title: "Feito para a saúde",
      text: "Linguagem e fluxo pensados para quem atende, não para planilhas.",
    },
  ],
  stepsTitle: "Simples assim",
  stepsLead: "Três passos do áudio ao material clínico pronto para revisão.",
  steps: [
    {
      title: "1. Grave",
      text: "Registre o áudio da consulta no seu dispositivo, com fluxo guiado no app.",
    },
    {
      title: "2. IA processa",
      text: "Transcrição e organização em seções clínicas para você validar com segurança.",
    },
    {
      title: "3. Pronto para revisar",
      text: "Resumo e histórico alinhados ao que foi dito — você mantém o controle final.",
    },
  ],
  beforeAfterTitle: "Do improviso ao padrão clínico",
  beforeAfterLead:
    "A ideia não é substituir o profissional — é reduzir atrito entre o que você ouve e o que precisa ficar documentado.",
  before: [
    "Anotações soltas e retrabalho depois do plantão",
    "Transcrição manual longa entre consultas",
    "Risco de esquecer detalhes importantes do atendimento",
  ],
  after: [
    "Áudio vira texto estruturado em poucos instantes",
    "Você revisa, ajusta e segue o atendimento",
    "Histórico e resumo alinhados ao que foi falado na consulta",
  ],
  featuresTitle: "Além da evolução em texto",
  featuresLead:
    "A plataforma reúne fluxos do ciclo do atendimento — da captação do áudio à organização do que importa para o cuidado.",
  features: [
    "Fichas e histórico do paciente em um só lugar",
    "Documentos clínicos auxiliados por IA (com sua revisão)",
    "Agenda, financeiro e assistente clínico no mesmo fluxo",
  ],
  ctaPrimary: "Começar teste grátis",
  ctaSecondary: "Ver landing do profissional",
} as const;

export const GATEWAY_PATIENT = {
  eyebrow: "Para pacientes",
  heroTitle:
    "Seu assistente de saúde pessoal, que se lembra e organiza pensando em você",
  title: "Seu Mapa de Saúde, com clareza",
  lead: "Organize exames, entenda o que importa e encontre horários com desconto perto de você — no seu ritmo.",
  benefits: [
    {
      title: "Mapa de Saúde",
      text: "Tarefas, resumos e histórico em um só lugar, sem jargão.",
    },
    {
      title: "Exames traduzidos",
      text: "Envie áudio ou laudos e receba orientação clara para conversar com o profissional.",
    },
    {
      title: "Horários com desconto",
      text: "Vitrine de vagas próximas — reserve com segurança quando fizer sentido.",
    },
  ],
  stepsTitle: "Como funciona para você",
  stepsLead: "Três passos para cuidar da saúde com mais clareza.",
  steps: [
    {
      title: "1. Crie sua conta",
      text: "Cadastro rápido de paciente — sem plano de consultório.",
    },
    {
      title: "2. Monte seu mapa",
      text: "Registre exames, áudios e o que você quer acompanhar no dia a dia.",
    },
    {
      title: "3. Aja com confiança",
      text: "Veja tarefas, resumos e horários disponíveis quando precisar marcar.",
    },
  ],
  beforeAfterTitle: "Da pasta de papéis ao mapa claro",
  beforeAfterLead:
    "Pacientes não precisam virar especialistas em laudos — precisam de clareza e próximos passos.",
  before: [
    "Exames espalhados em PDFs e fotos no celular",
    "Dúvidas sem contexto entre uma consulta e outra",
    "Dificuldade para achar horário sem ligar para vários consultórios",
  ],
  after: [
    "Histórico e tarefas reunidos no Mapa de Saúde",
    "Resumos em linguagem acessível para você revisar",
    "Vitrine de horários com desconto perto de você",
  ],
  featuresTitle: "O que você encontra no espaço do paciente",
  featuresLead:
    "Ferramentas pensadas para o cuidado contínuo — não para substituir o profissional.",
  features: [
    "Assistente pessoal para dúvidas sobre o seu mapa",
    "Perfis para dependentes (filhos, pais, etc.)",
    "Reserva de horários e acompanhamento após o agendamento",
  ],
  ctaPrimary: "Sou paciente — entrar",
  ctaSecondary: "Criar conta grátis",
  ctaTertiary: "Ver vitrine",
} as const;

export const GATEWAY_SECURITY = {
  title: "Segurança e responsabilidade com dados",
  lead: "Dados de saúde exigem cuidado. A Louzada Entregas é construída com princípios de privacidade e governança desde o desenho do produto.",
  items: [
    "Conformidade com a LGPD como referência no tratamento de dados pessoais e sensíveis",
    "Acesso autenticado às áreas do sistema que contêm informação clínica",
    "Boas práticas de validação e camadas de servidor para operações sensíveis",
  ],
} as const;
