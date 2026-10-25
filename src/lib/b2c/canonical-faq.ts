/**
 * FAQ canônico B2C + sementes para cache semântico (sem PHI).
 */

import { normalizeCommandText } from "@/lib/scheduling-command-terms";

type FaqEntry = {
  id: string;
  patterns: RegExp[];
  reply: string;
  /** Frases exemplar para seed do cache semântico. */
  seedQueries: string[];
};

const FAQ_ENTRIES: FaqEntry[] = [
  {
    id: "mapa",
    patterns: [
      /como (funciona|usar|abrir) (o )?mapa/,
      /o que (e|é) o mapa de saude/,
      /mapa de saude/,
      /para que (serve|e|é) (o )?mapa/,
      /o que tem no mapa/,
    ],
    reply:
      "O Mapa de Saúde guarda consultas, exames e tarefas deste perfil. Você pode gravar um trecho da consulta, enviar até 3 anexos de exame e conversar com o assessor sobre a sua memória. Abra /mapa-saude para ver o panorama, as tarefas e a vitrine de horários.",
    seedQueries: [
      "como funciona o mapa de saude",
      "o que e o mapa de saude",
      "para que serve o mapa",
      "como usar o mapa de saude",
      "o que tem no meu mapa de saude",
    ],
  },
  {
    id: "consulta",
    patterns: [
      /substitui (uma )?consulta/,
      /nao substitui consulta/,
      /substitui o medico/,
      /substitui o profissional/,
      /e um medico\b/,
      /posso confiar (so|somente) (no|nesse) (assessor|chat)/,
    ],
    reply:
      "Não: o assessor organiza o que você já registrou e explica em linguagem simples, mas não substitui consulta presencial nem diagnóstico. Em dúvida ou urgência, fale com um profissional ou vá ao pronto-socorro.",
    seedQueries: [
      "o assessor substitui uma consulta",
      "isso substitui o medico",
      "posso confiar so no chat",
      "nao substitui consulta",
    ],
  },
  {
    id: "lgpd",
    patterns: [
      /lgpd/,
      /privacidade/,
      /meus dados/,
      /quem ve meus dados/,
      /dados (estao|estão) seguros/,
      /voces vendem (meus )?dados/,
    ],
    reply:
      "Seus dados de saúde ficam ligados à sua conta de paciente e ao perfil ativo (titular ou dependente). O acesso clínico no app passa pelo servidor autenticado — não usamos isso para treinar modelos públicos. Você controla o que envia (áudio/exame) e pode gerenciar o perfil no Mapa de Saúde.",
    seedQueries: [
      "meus dados estao seguros",
      "quem ve meus dados",
      "lgpd no mapa de saude",
      "voces vendem meus dados",
      "privacidade do paciente",
    ],
  },
  {
    id: "exame",
    patterns: [
      /como (envio|mandar|anexar) (um )?exame/,
      /enviar exame/,
      /upload de exame/,
      /mandar (foto|pdf) (do|de) (exame|laudo)/,
    ],
    reply:
      "No Mapa de Saúde, use a área de captura: envie foto ou PDF do exame (até 3 anexos no mesmo envio, se quiser junto com áudio curto da consulta). A IA organiza um resumo em linguagem clara e pode criar tarefas (retorno, novo exame, etc.).",
    seedQueries: [
      "como envio um exame",
      "como anexar exame no mapa",
      "mandar foto do laudo",
      "upload de exame",
    ],
  },
  {
    id: "gravar",
    patterns: [
      /como (gravo|gravar) (a )?consulta/,
      /gravar audio/,
      /audio da consulta/,
      /posso gravar (o )?atendimento/,
    ],
    reply:
      "No Mapa de Saúde, grave um trecho curto da consulta (até alguns minutos). O sistema transcreve e guarda um resumo + tarefas no perfil ativo. Peça autorização às pessoas na sala antes de gravar.",
    seedQueries: [
      "como gravar a consulta",
      "posso gravar o atendimento",
      "gravar audio da consulta",
    ],
  },
  {
    id: "vitrine",
    patterns: [
      /como (uso|usar|abrir) (a )?vitrine/,
      /onde marco (consulta|horario)/,
      /como agendar/,
      /onde (acho|encontro) profissional/,
    ],
    reply:
      "Na vitrine (/vitrine) você vê profissionais com horários disponíveis, inclusive com desconto de ociosidade quando houver. Ao reservar, o horário entra nas suas tarefas do Mapa de Saúde.",
    seedQueries: [
      "como usar a vitrine",
      "onde marco consulta",
      "como agendar horario",
      "onde acho profissional",
    ],
  },
  {
    id: "dependente",
    patterns: [
      /dependente/,
      /perfil (do|da) (filho|filha|mae|pai|conjuge)/,
      /trocar (de )?perfil/,
      /outra pessoa no mapa/,
    ],
    reply:
      "Você pode criar perfis de dependentes no Mapa de Saúde e alternar o perfil ativo. Consultas, exames, tarefas e o chat do assessor ficam isolados por perfil — confira qual está selecionado antes de enviar áudio ou exame.",
    seedQueries: [
      "como adicionar dependente",
      "trocar de perfil no mapa",
      "mapa do meu filho",
    ],
  },
  {
    id: "tarefas_faq",
    patterns: [
      /o que (sao|são) (as )?tarefas/,
      /para que (servem|serve) (as )?tarefas/,
      /como (marco|marcar) tarefa (como )?feita/,
    ],
    reply:
      "As tarefas do Mapa são próximos passos gerados a partir das suas consultas e exames (medicação, retorno, novo exame, etc.). Elas aparecem no panorama; conclua quando fizer e pergunte ao assessor “quais minhas tarefas” para listar as pendentes.",
    seedQueries: [
      "o que sao as tarefas do mapa",
      "para que servem as tarefas",
      "como marcar tarefa como feita",
    ],
  },
];

/** FAQ operacional do profissional (seed/cache; wiring Ester = Fase C). */
const PRO_FAQ_SEED: Array<{ query: string; reply: string; intent: string }> = [
  {
    intent: "pro_ester",
    query: "o que e a ester",
    reply:
      "A Ester é o chat clínico do profissional no Louzada Entregas: cruza ficha do paciente, evidência (quando pedida) e contexto de agenda/financeiro só com gatilhos explícitos. Não substitui seu julgamento clínico.",
  },
  {
    intent: "pro_evolucao",
    query: "como funciona a nova evolucao por audio",
    reply:
      "Na Nova Evolução você dita até o limite do plano (2/3/6 min). O áudio vai ao servidor; modelos econômicos transcrevem quando necessário e o Pro estrutura o documento. Revise sempre antes de salvar.",
  },
  {
    intent: "pro_agenda_voz",
    query: "como marcar consulta por voz na agenda",
    reply:
      "Na Agenda, use o intake por áudio/texto. O léxico pt-BR classifica criar/remarcar/cancelar sem gastar modelo caro; a IA só completa nome, data e hora quando ambíguo.",
  },
];

/**
 * Retorna resposta canônica se a pergunta casar com FAQ de produto.
 */
export function matchCanonicalProductFaq(userText: string): string | null {
  const n = normalizeCommandText(userText);
  if (!n) return null;
  for (const entry of FAQ_ENTRIES) {
    if (entry.patterns.some((p) => p.test(n))) {
      return entry.reply;
    }
  }
  return null;
}

/** Id do FAQ + reply quando houver match (para intent no cache). */
export function matchCanonicalProductFaqEntry(
  userText: string,
): { id: string; reply: string } | null {
  const n = normalizeCommandText(userText);
  if (!n) return null;
  for (const entry of FAQ_ENTRIES) {
    if (entry.patterns.some((p) => p.test(n))) {
      return { id: entry.id, reply: entry.reply };
    }
  }
  return null;
}

/** Sementes (paciente + pro) para o cache semântico — sem PHI. */
export function getCanonicalFaqSeedEntries(): Array<{
  query: string;
  reply: string;
  intent: string;
}> {
  const patient = FAQ_ENTRIES.flatMap((entry) =>
    entry.seedQueries.map((query) => ({
      query,
      reply: entry.reply,
      intent: `product_faq:${entry.id}`,
    })),
  );
  return [...patient, ...PRO_FAQ_SEED];
}
