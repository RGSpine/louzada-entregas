/**
 * Respostas R0 B2C a partir de Prisma (tarefas / retornos) — sem LLM.
 */

import { prisma } from "@/lib/prisma";
import type { B2cOrchestratorDecision } from "@/lib/b2c/orchestrator-risk";
import { matchCanonicalProductFaq } from "@/lib/b2c/canonical-faq";
import {
  getMarketplaceShowcaseProfessionals,
  showcaseListingId,
  type ShowcaseProfessional,
} from "@/lib/marketplace/showcase-data";
import type { HealthManagerProfessionalSuggestion } from "@/lib/b2c/health-manager";

export type R0OperationalReply = {
  reply: string;
  professionals: HealthManagerProfessionalSuggestion[];
  conclusions: string[];
};

function formatTaskLine(task: {
  title: string;
  type: string;
  scheduledTime: Date | null;
}): string {
  const when = task.scheduledTime
    ? task.scheduledTime.toLocaleString("pt-BR")
    : "sem data marcada";
  return `• [${task.type}] ${task.title} — ${when}`;
}

function showcaseToSuggestions(
  catalog: ShowcaseProfessional[],
  max = 3,
): HealthManagerProfessionalSuggestion[] {
  return catalog.slice(0, max).map((pro) => {
    const next = pro.slots[0] ?? null;
    return {
      profileId: showcaseListingId(pro),
      name: pro.name,
      profession: pro.profession,
      specialty: pro.specialties[0] ?? pro.profession,
      headline: pro.publicHeadline,
      city: pro.city,
      state: pro.state,
      nextSlotId: next?.id ?? null,
      nextSlotAt: next?.datetime ?? null,
      effectivePrice: next?.effectivePrice ?? null,
      reason: next
        ? "Horário disponível na vitrine agora."
        : "Profissional cadastrado na vitrine.",
    };
  });
}

/**
 * Tenta responder R0 só com dados persistidos / FAQ / vitrine leve.
 * Retorna null se não houver material suficiente (chat deve usar Flash enxuto).
 */
export async function tryBuildR0OperationalReply(input: {
  healthProfileId: string;
  userText: string;
  decision: B2cOrchestratorDecision;
}): Promise<R0OperationalReply | null> {
  const { decision, userText, healthProfileId } = input;

  if (decision.wantsProductFaq || decision.intent === "product_faq") {
    const faq = matchCanonicalProductFaq(userText);
    if (faq) {
      return { reply: faq, professionals: [], conclusions: [] };
    }
  }

  if (decision.wantsTasksOrSchedule || decision.intent === "tasks") {
    const tasks = await prisma.healthTask.findMany({
      where: { healthProfileId, isCompleted: false },
      orderBy: [{ scheduledTime: "asc" }, { createdAt: "desc" }],
      take: 8,
      select: {
        title: true,
        type: true,
        scheduledTime: true,
      },
    });

    if (tasks.length === 0) {
      return {
        reply:
          "Não há tarefas pendentes neste perfil agora. Quando você gravar uma consulta ou enviar um exame, os próximos passos (remédio, retorno, exame) aparecem aqui no Mapa de Saúde.",
        professionals: [],
        conclusions: ["Sem tarefas pendentes no perfil ativo."],
      };
    }

    const withTime = tasks.filter((t) => t.scheduledTime);
    const next = withTime[0] ?? tasks[0];
    const lines = tasks.map(formatTaskLine).join("\n");
    const reply = [
      next.scheduledTime
        ? `Seu próximo compromisso registrado é: ${next.title} em ${next.scheduledTime.toLocaleString("pt-BR")}.`
        : `Você tem ${tasks.length} tarefa(s) pendente(s). A mais recente/prioritária: ${next.title}.`,
      "",
      "Pendências:",
      lines,
      "",
      "Isto vem do que já está no seu Mapa de Saúde — não substitui orientação do seu profissional.",
    ].join("\n");

    return {
      reply,
      professionals: [],
      conclusions: [
        `${tasks.length} tarefa(s) pendente(s)`,
        next.scheduledTime
          ? `Próximo: ${next.title} · ${next.scheduledTime.toLocaleString("pt-BR")}`
          : `Destaque: ${next.title}`,
      ],
    };
  }

  if (decision.wantsProfessional || decision.intent === "vitrine") {
    const catalog = await getMarketplaceShowcaseProfessionals({ audience: "patient" });
    const withSlots = catalog.filter((pro) => pro.slots.length > 0);
    const professionals = showcaseToSuggestions(
      withSlots.length > 0 ? withSlots : catalog,
      3,
    );
    if (professionals.length === 0) {
      return {
        reply:
          "Neste momento a vitrine não tem profissionais listados. Abra /vitrine mais tarde — novos cards e horários aparecem conforme o cadastro e as ofertas.",
        professionals: [],
        conclusions: ["Vitrine vazia agora."],
      };
    }
    const hasSlots = professionals.some((pro) => pro.nextSlotId != null);
    const lines = professionals
      .map((pro, i) => {
        const when = pro.nextSlotAt
          ? new Date(pro.nextSlotAt).toLocaleString("pt-BR")
          : "horário a confirmar";
        const price =
          pro.effectivePrice != null ? ` · R$${pro.effectivePrice}` : "";
        return `${i + 1}. ${pro.name}${pro.specialty ? ` · ${pro.specialty}` : ""} — ${when}${price}`;
      })
      .join("\n");
    return {
      reply: [
        hasSlots
          ? "Encontrei estes horários na vitrine (sem passar por análise clínica nesta mensagem):"
          : "Encontrei estes profissionais na vitrine (ainda sem horário ofertado):",
        lines,
        "",
        "Para ver todos e reservar, abra /vitrine. Se quiser indicação por sintomas ou histórico, descreva o que está sentindo.",
      ].join("\n"),
      professionals,
      conclusions: ["Sugestões da vitrine (R0, sem LLM clínico)."],
    };
  }

  const faq = matchCanonicalProductFaq(userText);
  if (faq) {
    return { reply: faq, professionals: [], conclusions: [] };
  }

  return null;
}
