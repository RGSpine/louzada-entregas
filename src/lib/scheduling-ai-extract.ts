import type { Part } from "@google/generative-ai";
import { generateContentSafeWithModelFallback } from "@/lib/gemini";
import { formatAiProviderErrorForUser } from "@/lib/ai-provider-user-message";
import {
  schedulingModelOutputSchema,
  type SchedulingModelOutput,
} from "@/lib/scheduling-intent-schema";

export type SchedulingPatientContext = { id: string; name: string };
export type SchedulingServiceContext = { id: string; name: string; defaultPriceCents: number };
export type SchedulingResourceContext = { id: string; name: string };

function stripJsonFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseModelJson(text: string): unknown {
  try {
    return JSON.parse(stripJsonFences(text));
  } catch {
    return null;
  }
}

function buildPrompt(
  patients: SchedulingPatientContext[],
  services: SchedulingServiceContext[],
  resources: SchedulingResourceContext[] = [],
): string {
  const patientList =
    patients.length > 0
      ? patients.map((p) => `- ${p.name}`).join("\n")
      : "(nenhum paciente cadastrado)";

  const serviceList =
    services.length > 0
      ? services
          .map(
            (s) =>
              `- ${s.name}${s.defaultPriceCents > 0 ? ` (R$ ${(s.defaultPriceCents / 100).toFixed(2).replace(".", ",")})` : ""}`,
          )
          .join("\n")
      : "(nenhum serviço no catálogo)";

  const resourceList =
    resources.length > 0
      ? resources.map((r) => `- ${r.name}`).join("\n")
      : "(nenhuma sala/recurso cadastrado)";

  return `
Extrais intenções de AGENDA a partir do áudio ou imagem (anotações, agenda em papel, pedidos de exame com data).
Todo atendimento é um SERVIÇO do catálogo (consulta avulsa, retorno ou sessão de pacote são formas de cobrar o mesmo serviço).

Pacientes já cadastrados (referência; o nome no áudio pode NÃO estar nesta lista):
${patientList}

Serviços do catálogo financeiro (associe quando o profissional disser nome ou valor compatível):
${serviceList}

Salas e recursos físicos da clínica (associe em resourceNameGuess quando o profissional citar a sala):
${resourceList}

## Seis operações possíveis

**CRIAR** (action "create") — verbos: marcar, marque, marca, marcação, agendar, agende, agenda, agendamento, "faça/faz o agendamento", encaixar, encaixe, reservar, reserve, colocar, coloque, incluir, inclua, botar, ponha, "põe na agenda", "nova consulta".

**REMARCAR** (action "reschedule") — mover um paciente JÁ marcado para outro dia/hora. Verbos: remarcar, remarque, reagendar, reagende, transferir, transfira, "mudar o horário", "mudar o dia", trocar (consulta/horário), alterar (horário/dia), adiar, adie, antecipar, antecipe, passar, passe, mover, mova, empurrar, realocar. NÃO uses "reschedule" para "mudar o nome" / "renomear".

**DESMARCAR** (action "cancel") — retirar da agenda um paciente JÁ marcado SEM registrar falta. Verbos: desmarcar, desmarque, cancelar, cancele, cancelamento, anular, anule, excluir, exclua, apagar, apague, remover, remova, "tirar da agenda", suspender. NÃO uses "cancel" para "não vem" / "faltou" / "não compareceu".

**FALTA JUSTIFICADA** (action "no_show") — paciente confirmou e não compareceu / desistiu em cima da hora; o horário fica livre mas a falta fica registrada com causa. Frases: "não vem", "não vai vir", "não pode vir", "não compareceu", "não veio", "faltou", "marcar falta", "registrar falta", "falta justificada", "deu para trás". Preenche noShowReason com a causa ouvida (ex.: "imprevisto familiar", "atraso no transporte"). Se só disser "a Karina não vem amanhã" sem causa explícita, usa uma causa curta do contexto ("não compareceu") — nunca deixe noShowReason vazio. NÃO é desmarcar.

**RENOMEAR** (action "rename") — só mudar o nome/rótulo exibido de um evento já na agenda (ex.: "FECHADO" → paciente). Verbos: renomear, renomeie, "corrigir o nome", "mudar o nome", "trocar o nome", "alterar o nome". patientNameGuess = nome atual no card; newPatientNameGuess = novo nome. NÃO é remarcação.

**YIELD** (action "yield") — liberar o horário no marketplace com desconto de ociosidade. Verbos: "joga pro desconto", "coloca no yield", "oferece com X% de desconto", "horário vago com desconto". Se vier depois de um cancelamento no mesmo áudio, usa itemAction "cancel" no cancelamento e preenche discountYield; se for só oferta, action "yield" + discountYield.

Atenção aos radicais parecidos: "desmarque" e "remarque" NUNCA são "create"; "reagende" NUNCA é "create". O prefixo (des-, re-) muda a operação. "mude o nome" é "rename"; "mude o horário" é "reschedule". "não vem" / "faltou" é "no_show", NÃO "cancel".

Regras:
- action global = operação dominante do áudio. Se o mesmo áudio misturar operações, preenche itemAction em CADA item ("create" | "reschedule" | "cancel" | "no_show" | "rename" | "yield") e usa a dominante no action global.
- action "none" se for só exame clínico ou conversa sem pedido de agenda.
- action "ambiguous" só se faltar dado essencial: criar exige nome + data + horário; remarcar exige nome + destino (nova data e/ou nova hora); desmarcar exige nome; falta exige nome + noShowReason (≥ 3 caracteres); renomear exige nome atual + novo nome.
- patientNameGuess: transcreve o nome ouvido (paciente novo é permitido em "create"; em "reschedule"/"cancel"/"no_show"/"rename" o rótulo já existe na agenda — pode ser título Google como "FECHADO").
- dateExpression em pt-BR: copie a expressão ouvida quando possível — "hoje", "amanhã", "essa terça", "esta quinta", "próxima segunda", "26/05", "dia 26", "30 de abril", "terça 18/08". O servidor resolve no timezone America/Sao_Paulo. Em lista "terça e quinta", o servidor alinha ambos à **mesma semana civil** (não misture "próxima terça" com "quinta=amanhã").
- timeExpression: transcreva a hora dita ("16h", "16:00", "às 16"). Nunca omita se o utilizador disse a hora. Não uses horários de interface ou suposições. OBRIGATÓRIO em "create".
- MULTI-DIA (mesmo paciente + mesma hora em vários dias):
  - Lista de weekdays: "terça e quinta", "segunda, quarta e sexta" → preferível dateExpression composto "terça e quinta" OU um objeto por weekday com o MESMO patientNameGuess e timeExpression. Preferível datas dd/MM quando o profissional as disser ("terça 18/08 e quinta 20/08").
  - Série: "próximas 8 segundas", "as próximas oito terças", "nas próximas 4 sextas" → um item com dateExpression composto ("próximas 8 segundas") OU N itens com datas dd/MM/aaaa distintas. NUNCA repitas "próxima segunda" N vezes (cairiam no mesmo dia).
  - dateExpression NÃO deve incluir a hora ("terça e quinta", nunca "terça e quinta às 19:30").
- Em "reschedule", "cancel", "no_show" e "rename", dateExpression/timeExpression descrevem a marcação ATUAL e são OPCIONAIS.
- newDateExpression / newTimeExpression: SÓ em "reschedule" — o destino. "Remarque a Ana para sexta às 16h" → newDateExpression "sexta", newTimeExpression "16h". Se ele só mudar a hora ("mude a Ana para as 15h"), preenche apenas newTimeExpression; se só mudar o dia ("passe a Ana para sexta"), apenas newDateExpression. Remarcar/desmarcar/falta/renomear NÃO expandem multi-dia.
- newPatientNameGuess: SÓ em "rename" — o novo nome. "Renomeie FECHADO para Eric" → patientNameGuess "FECHADO", newPatientNameGuess "Eric".
- noShowReason: SÓ em "no_show" — causa relatada (≥ 3 caracteres). "A Karina não vem amanhã, imprevisto familiar" → noShowReason "imprevisto familiar".
- Nunca uses newDateExpression/newTimeExpression em "create", "cancel", "no_show" ou "rename".
- durationMinutes: padrão 60 se não disser.
- visitKind (opcional): "UNIQUE_CONSULTATION" (avulso/1 sessão), "RETURN" (retorno), "TREATMENT_PLAN" (sessão de pacote já vendido). Inferir do áudio.
- serviceNameGuess (opcional): nome do serviço/produto mencionado (ex.: "fisioterapia", "nutrição", "avaliação"). Casar com o catálogo acima quando possível.
- careSetting (opcional): "IN_PERSON_CLINIC" (consultório/clínica/presencial), "ONLINE" (teleconsulta/online), "HOME_VISIT" (domiciliar/em casa). Inferir quando mencionado.
- notes (opcional): observações — endereço domiciliar, link online, orientações. Sanitize mentalmente; não inventar. Em "no_show", a causa vai em noShowReason (não em notes).
- priceCents (opcional): valor em centavos só se o profissional disser valor explícito (ex.: "duzentos reais" → 20000). Não inventar.
- confirmationStatus (opcional): "PENDING_CONFIRMATION" se disser que esse(s) paciente(s) falta/faltam confirmar; "CONFIRMED" se disser que já está/estão confirmado(s); omitir se não mencionar (o sistema assume falta confirmar). Atenção: "falta confirmar" ≠ action "no_show".
- resourceNameGuess (opcional): nome da sala/recurso ouvido ("sala de Pilates", "maca de quiropraxia"). Casar com a lista acima quando possível. Null se não citar sala.
- discountYield (opcional): inteiro 1–90 se pediu desconto de ociosidade ("30% de desconto"). Null se não falou em desconto/yield.
- appointments: lista com UMA entrada por paciente/dia/horário (várias operações ou vários dias no mesmo áudio = vários objetos no array; máximo 16).
- Vários pacientes na mesma frase: repete dateExpression em cada entrada (ex.: todos "amanhã") mas timeExpression e patientNameGuess distintos por slot.
- NUNCA juntes dois pacientes num único objeto; NUNCA inventes horário que não foi dito.
- NUNCA afirmes que o horário está livre.
- confidenceOverall entre 0 e 1.

Exemplo 1 — criar, áudio: "Marque para amanhã às 08:30 o Caio, às 09:30 o Victor e às 10:30 a Viviane"
{
  "action": "create",
  "appointments": [
    { "patientNameGuess": "Caio", "dateExpression": "amanhã", "timeExpression": "08:30", "durationMinutes": 60, "title": null },
    { "patientNameGuess": "Victor", "dateExpression": "amanhã", "timeExpression": "09:30", "durationMinutes": 60, "title": null },
    { "patientNameGuess": "Viviane", "dateExpression": "amanhã", "timeExpression": "10:30", "durationMinutes": 60, "title": null }
  ],
  "transcriptOrSummary": "Três consultas amanhã: Caio 08:30, Victor 09:30, Viviane 10:30.",
  "confidenceOverall": 0.9
}

Exemplo 2 — criar com sinónimo, áudio: "Faça o agendamento do Michel para a próxima segunda às 14h"
{
  "action": "create",
  "appointments": [
    { "patientNameGuess": "Michel", "dateExpression": "próxima segunda", "timeExpression": "14h", "durationMinutes": 60 }
  ],
  "transcriptOrSummary": "Michel na próxima segunda às 14h.",
  "confidenceOverall": 0.9
}

Exemplo 2b — mesmo paciente em vários weekdays, áudio: "Marque para terça e quinta às 19:30 Eric"
{
  "action": "create",
  "appointments": [
    { "patientNameGuess": "Eric", "dateExpression": "terça e quinta", "timeExpression": "19:30", "durationMinutes": 60 }
  ],
  "transcriptOrSummary": "Eric terça e quinta às 19:30.",
  "confidenceOverall": 0.9
}

Exemplo 2b2 — weekdays com datas explícitas, áudio: "Marcar para terça feira, 18/08, e quinta feira, 20/08, o paciente Eric às 19:30"
{
  "action": "create",
  "appointments": [
    { "patientNameGuess": "Eric", "dateExpression": "terça 18/08 e quinta 20/08", "timeExpression": "19:30", "durationMinutes": 60 }
  ],
  "transcriptOrSummary": "Eric terça 18/08 e quinta 20/08 às 19:30.",
  "confidenceOverall": 0.9
}

Exemplo 2c — série semanal, áudio: "Agende as próximas 3 segundas às 10h a Marina"
{
  "action": "create",
  "appointments": [
    { "patientNameGuess": "Marina", "dateExpression": "próximas 3 segundas", "timeExpression": "10h", "durationMinutes": 60 }
  ],
  "transcriptOrSummary": "Marina nas próximas 3 segundas às 10h.",
  "confidenceOverall": 0.9
}
(Nota: o servidor expande "próximas N segundas/terças/…" em N datas distintas. Se já souberes as datas civis, podes emitir N itens com dateExpression dd/MM/aaaa distintos — NUNCA repitas "próxima segunda" N vezes, pois todas cairiam no mesmo dia.)

Exemplo 3 — remarcar, áudio: "Reagende a Karina de amanhã às 14h para quinta às 16h"
{
  "action": "reschedule",
  "appointments": [
    { "patientNameGuess": "Karina", "dateExpression": "amanhã", "timeExpression": "14h", "newDateExpression": "quinta", "newTimeExpression": "16h" }
  ],
  "transcriptOrSummary": "Karina muda de amanhã 14h para quinta 16h.",
  "confidenceOverall": 0.9
}

Exemplo 4 — remarcar só a hora, áudio: "Mude o horário do Pedro para as 15h"
{
  "action": "reschedule",
  "appointments": [
    { "patientNameGuess": "Pedro", "dateExpression": null, "timeExpression": null, "newDateExpression": null, "newTimeExpression": "15h" }
  ],
  "transcriptOrSummary": "Pedro passa para as 15h.",
  "confidenceOverall": 0.85
}

Exemplo 5 — desmarcar vários, áudio: "Desmarque a Ana e cancele o João de amanhã"
{
  "action": "cancel",
  "appointments": [
    { "patientNameGuess": "Ana", "dateExpression": "amanhã", "timeExpression": null },
    { "patientNameGuess": "João", "dateExpression": "amanhã", "timeExpression": null }
  ],
  "transcriptOrSummary": "Desmarcar Ana e João de amanhã.",
  "confidenceOverall": 0.9
}

Exemplo 5a — falta justificada, áudio: "A Karina não vem amanhã, imprevisto familiar"
{
  "action": "no_show",
  "appointments": [
    {
      "patientNameGuess": "Karina",
      "dateExpression": "amanhã",
      "timeExpression": null,
      "noShowReason": "imprevisto familiar"
    }
  ],
  "transcriptOrSummary": "Falta da Karina amanhã: imprevisto familiar.",
  "confidenceOverall": 0.9
}

Exemplo 5a2 — marcar falta, áudio: "Registre a falta do João de hoje às 15h, atraso no transporte"
{
  "action": "no_show",
  "appointments": [
    {
      "patientNameGuess": "João",
      "dateExpression": "hoje",
      "timeExpression": "15h",
      "noShowReason": "atraso no transporte"
    }
  ],
  "transcriptOrSummary": "Falta do João hoje 15h: atraso no transporte.",
  "confidenceOverall": 0.9
}

Exemplo 5b — renomear evento, áudio: "Renomeie FECHADO para Eric"
{
  "action": "rename",
  "appointments": [
    { "patientNameGuess": "FECHADO", "newPatientNameGuess": "Eric" }
  ],
  "transcriptOrSummary": "Renomear FECHADO para Eric.",
  "confidenceOverall": 0.9
}

Exemplo 6 — operações mistas, áudio: "Desmarque a Ana de amanhã e agende o Bruno para sexta às 9h"
{
  "action": "cancel",
  "appointments": [
    { "itemAction": "cancel", "patientNameGuess": "Ana", "dateExpression": "amanhã" },
    { "itemAction": "create", "patientNameGuess": "Bruno", "dateExpression": "sexta", "timeExpression": "9h", "durationMinutes": 60 }
  ],
  "transcriptOrSummary": "Ana desmarcada de amanhã; Bruno marcado sexta 9h.",
  "confidenceOverall": 0.85
}

Exemplo 7 — cancelar + yield, áudio: "Cancela o atendimento do João hoje às 15h na sala de Pilates e joga esse horário vago pro desconto de 30%"
{
  "action": "cancel",
  "appointments": [
    {
      "itemAction": "cancel",
      "patientNameGuess": "João",
      "dateExpression": "hoje",
      "timeExpression": "15h",
      "resourceNameGuess": "sala de Pilates",
      "discountYield": 30
    }
  ],
  "transcriptOrSummary": "Cancelar João hoje 15h na sala de Pilates e oferecer 30% de desconto.",
  "confidenceOverall": 0.9
}

JSON EXACTO (schema final — segue os exemplos acima):
{
  "action": "create" | "book" | "reschedule" | "cancel" | "no_show" | "rename" | "yield" | "none" | "ambiguous",
  "appointments": [
    {
      "itemAction": "create" | "book" | "reschedule" | "cancel" | "no_show" | "rename" | "yield" | null,
      "patientNameGuess": string | null,
      "dateExpression": string | null,
      "timeExpression": string | null,
      "newDateExpression": string | null,
      "newTimeExpression": string | null,
      "newPatientNameGuess": string | null,
      "noShowReason": string | null,
      "durationMinutes": number | null,
      "title": string | null,
      "visitKind": "UNIQUE_CONSULTATION" | "RETURN" | "TREATMENT_PLAN" | null,
      "careSetting": "IN_PERSON_CLINIC" | "ONLINE" | "HOME_VISIT" | null,
      "notes": string | null,
      "priceCents": number | null,
      "serviceNameGuess": string | null,
      "confirmationStatus": "PENDING_CONFIRMATION" | "CONFIRMED" | null,
      "resourceNameGuess": string | null,
      "discountYield": number | null
    }
  ],
  "transcriptOrSummary": string | null,
  "confidenceOverall": number
}
`.trim();
}

export async function extractSchedulingIntent(params: {
  patients: SchedulingPatientContext[];
  services?: SchedulingServiceContext[];
  resources?: SchedulingResourceContext[];
  audio: { base64: string; mimeType: string };
}): Promise<{ ok: true; data: SchedulingModelOutput } | { ok: false; error: string }> {
  const { patients, services = [], resources = [], audio } = params;
  if (!audio?.base64) {
    return { ok: false, error: "Envie um áudio de comando." };
  }

  const parts: Part[] = [
    { text: buildPrompt(patients, services, resources) },
    {
      inlineData: { mimeType: audio.mimeType || "audio/webm", data: audio.base64 },
    },
    { text: "(áudio acima — extrai agendamentos)" },
  ];

  try {
    const { result } = await generateContentSafeWithModelFallback(
      {
        systemInstruction: `
És assistente de agenda clínica no Brasil (timezone America/Sao_Paulo).
Respondes apenas JSON válido, sem markdown.
Classificas a operação em: criar ("create" ou "book"), remarcar ("reschedule"), desmarcar ("cancel"), falta justificada ("no_show"), renomear ("rename") ou oferta de ociosidade ("yield").
Presta atenção ao prefixo do verbo: "marque/agende" = create; "remarque/reagende" = reschedule; "desmarque/cancele" = cancel; "não vem/faltou/não compareceu/marcar falta" = no_show (preenche noShowReason); "renomeie/corrigir o nome/mudar o nome" = rename; "joga pro desconto/oferece com X%" = yield (preenche discountYield). Errar o prefixo altera a agenda do profissional de forma errada.
"não vem" / "faltou" NUNCA é "cancel" — é "no_show" com justificativa.
Se citar sala/recurso, preenche resourceNameGuess. Se pedir desconto no horário vago, preenche discountYield (1–90).
Pacientes novos (ainda sem ficha) são permitidos apenas em "create": extrai o nome dito no áudio em patientNameGuess.
Em "rename": patientNameGuess = rótulo atual no card; newPatientNameGuess = novo nome.
Em "no_show": patientNameGuess + noShowReason (≥ 3 caracteres); dateExpression/timeExpression opcionais para achar a marcação.
A lista de cadastrados serve só como referência de grafia.
Se o profissional pedir vários horários no mesmo áudio (ex.: Caio 08:30, Victor 09:30, Viviane 10:30 amanhã), devolve um objeto em appointments por cada par nome+hora; não colapses num único item.
Se pedir o MESMO paciente/hora em vários dias ("terça e quinta às 19:30 Eric", "próximas 8 segundas às 10h"), devolve um objeto por dia — nunca um único dateExpression composto com vários weekdays, salvo o atalho "próximas N segundas" que o servidor também expande.
Em "create" cada agendamento exige timeExpression próprio — nunca omitas a hora dita para cada paciente.
Em "reschedule" o destino vai em newDateExpression/newTimeExpression; em "cancel", "no_show" e "rename" nunca preenchas esses campos.
`.trim(),
        generationConfig: {
          temperature: 0.12,
          responseMimeType: "application/json",
        },
      },
      parts,
      120_000,
    );

    const text = result.response.text();
    if (!text?.trim()) {
      return { ok: false, error: "Modelo não devolveu conteúdo." };
    }
    const json = parseModelJson(text);
    const parsed = schedulingModelOutputSchema.safeParse(json);
    if (!parsed.success) {
      return { ok: false, error: "Resposta da IA não pôde ser validada." };
    }
    return { ok: true, data: parsed.data };
  } catch (e) {
    return { ok: false, error: formatAiProviderErrorForUser(e) };
  }
}
