import test from "node:test";
import assert from "node:assert/strict";
import {
  detectSchedulingCommandKind,
  normalizeCommandText,
  reconcileSchedulingAction,
} from "./scheduling-command-terms";

test("normalizeCommandText remove acentos e normaliza espaços", () => {
  assert.equal(normalizeCommandText("  Agende   a MARCAÇÃO  "), "agende a marcacao");
  assert.equal(normalizeCommandText(null), "");
});

test("detecta criação em marcar/marque e sinônimos de agendar", () => {
  for (const phrase of [
    "Marque a Karina amanhã às 16h",
    "Marcar o João para sexta às 10h",
    "Agende o Michel para a próxima segunda às 14h",
    "Agendar a Ana dia 26 às 9h",
    "Faça o agendamento da Paula amanhã às 8h",
    "Faz o agendamento do Pedro na terça às 15h",
    "Nova marcação para o Caio amanhã às 11h",
    "Encaixe a Viviane hoje às 17h",
    "Reserve o horário do Victor quinta às 13h",
  ]) {
    assert.equal(detectSchedulingCommandKind(phrase), "create", phrase);
  }
});

test("detecta remarcação em remarque/reagende e sinônimos", () => {
  for (const phrase of [
    "Remarque a Karina para quinta às 16h",
    "Remarcar o João para sexta",
    "Reagende a Ana para amanhã às 10h",
    "Reagendar a consulta do Pedro",
    "Transfira a consulta da Paula para segunda",
    "Mude o horário do Caio para 15h",
    "Troque a consulta da Viviane para quarta",
    "Adie o atendimento do Victor para sexta",
    "Antecipe a sessão da Ana para terça",
    "Passe o Michel para sexta às 9h",
    "Mova a marcação do João para as 14h",
    "Altere o horário da Karina para 11h",
  ]) {
    assert.equal(detectSchedulingCommandKind(phrase), "reschedule", phrase);
  }
});

test("detecta desmarcação em desmarque/cancele e sinônimos", () => {
  for (const phrase of [
    "Desmarque a Karina de amanhã",
    "Desmarcar o João de sexta",
    "Cancele a consulta da Ana",
    "Cancelar o atendimento do Pedro amanhã",
    "Anule a sessão da Paula",
    "Exclua a marcação do Caio",
    "Apague a consulta da Viviane de quinta",
    "Remova o horário do Victor",
    "Tire o Michel da agenda de amanhã",
  ]) {
    assert.equal(detectSchedulingCommandKind(phrase), "cancel", phrase);
  }
});

test("detecta falta justificada e não confunde com desmarcar", () => {
  for (const phrase of [
    "A Karina não vem amanhã",
    "O João não vai vir hoje",
    "A Ana não pode vir",
    "O Pedro não compareceu",
    "A Paula faltou",
    "Marque falta da Karina, imprevisto familiar",
    "Registre a falta do João de hoje",
    "Falta justificada da Viviane",
  ]) {
    assert.equal(detectSchedulingCommandKind(phrase), "no_show", phrase);
  }
  assert.equal(
    detectSchedulingCommandKind("Desmarque a Karina de amanhã"),
    "cancel",
  );
});

test("radical de criação não vaza para desmarcar/remarcar", () => {
  // "desmarcar" contém "marcar" e "reagendar" contém "agendar":
  // a fronteira \b garante que não caiam em create.
  assert.equal(detectSchedulingCommandKind("desmarcar"), "cancel");
  assert.equal(detectSchedulingCommandKind("desmarque"), "cancel");
  assert.equal(detectSchedulingCommandKind("remarcar"), "reschedule");
  assert.equal(detectSchedulingCommandKind("remarque"), "reschedule");
  assert.equal(detectSchedulingCommandKind("reagendar"), "reschedule");
  assert.equal(detectSchedulingCommandKind("reagende"), "reschedule");
});

test("frase composta prioriza cancelar e depois remarcar sobre criar", () => {
  assert.equal(
    detectSchedulingCommandKind("Desmarque a consulta que eu agendei para a Karina"),
    "cancel",
  );
  assert.equal(
    detectSchedulingCommandKind("Remarque o agendamento do João para sexta"),
    "reschedule",
  );
});

test("termos genéricos sem contexto de agenda não classificam", () => {
  assert.equal(detectSchedulingCommandKind("mude o telefone"), null);
  assert.equal(detectSchedulingCommandKind("bom dia, tudo bem?"), null);
  assert.equal(detectSchedulingCommandKind(""), null);
});

test("detecta renomeação e não confunde com remarcação", () => {
  for (const phrase of [
    "Renomeie FECHADO para Eric",
    "Mude o nome do FECHADO para Eric",
    "Troque o nome FECHADO para Eric",
    "Corrigir o nome de FECHADO para Eric",
  ]) {
    assert.equal(detectSchedulingCommandKind(phrase), "rename", phrase);
  }
  assert.equal(detectSchedulingCommandKind("Mude o horário do Caio para 15h"), "reschedule");
});

test("reconcileSchedulingAction corrige create quando o texto pede desmarcar", () => {
  assert.equal(
    reconcileSchedulingAction({
      modelAction: "create",
      transcript: "Desmarque a Karina de amanhã",
    }),
    "cancel",
  );
  assert.equal(
    reconcileSchedulingAction({
      modelAction: "create",
      transcript: "Reagende o João para sexta às 10h",
    }),
    "reschedule",
  );
  assert.equal(
    reconcileSchedulingAction({
      modelAction: "create",
      transcript: "A Karina não vem amanhã, imprevisto familiar",
    }),
    "no_show",
  );
  assert.equal(
    reconcileSchedulingAction({
      modelAction: "cancel",
      transcript: "A Karina não vem amanhã",
    }),
    "no_show",
  );
});

test("detecta yield em frases de ociosidade e prioriza cancel no composto", () => {
  assert.equal(
    detectSchedulingCommandKind("Joga o horário das 15h hoje pro desconto de 30%"),
    "yield",
  );
  assert.equal(
    detectSchedulingCommandKind(
      "Cancela o atendimento do João hoje às 15h na sala de Pilates e joga esse horário vago pro desconto de 30%",
    ),
    "cancel",
  );
});

test("reconcileSchedulingAction preserva create legítimo e ações já explícitas", () => {
  assert.equal(
    reconcileSchedulingAction({
      modelAction: "create",
      transcript: "Agende a Ana amanhã às 9h",
    }),
    "create",
  );
  assert.equal(
    reconcileSchedulingAction({ modelAction: "cancel", transcript: "" }),
    "cancel",
  );
  assert.equal(
    reconcileSchedulingAction({ modelAction: "reschedule", transcript: "" }),
    "reschedule",
  );
  assert.equal(
    reconcileSchedulingAction({ modelAction: "ambiguous", transcript: "algo" }),
    null,
  );
});
