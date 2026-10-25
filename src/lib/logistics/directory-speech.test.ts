import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { interpretDirectorySpeech } from "@/lib/logistics/directory-speech";

describe("cadastro falado do diretório", () => {
  it("separa cliente com endereço e entregador novo", () => {
    const heard = interpretDirectorySpeech(
      "Cadastra o cliente Marcelo da Núcleo, o endereço é Rua A, 10. Cadastra o entregador Roberto.",
    );
    assert.equal(heard.couriers[0], "Roberto");
    const client = heard.clients.find((item) => item.clientName.toLowerCase().includes("marcelo"));
    assert.ok(client);
    assert.match(client!.address ?? "", /Rua A/i);
  });

  it("guarda telefone de cliente já citado", () => {
    const heard = interpretDirectorySpeech("O telefone do Marcelo é 11 98888-7766.");
    assert.equal(heard.couriers.length, 0);
    assert.equal(heard.clients[0]?.phone, "11 98888-7766");
  });
});
