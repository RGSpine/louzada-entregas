import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { interpretContactUpdates } from "@/lib/logistics/contact-update";

describe("atualização de endereço e telefone", () => {
  it("lê endereço e telefone escritos depois do cadastro", () => {
    const updates = interpretContactUpdates(
      "O endereço do Alessandro Paccini é Rua Comandante Marcondes Salgado 987. O telefone do Alessandro Paccini é 16 3446 3522",
    );
    assert.equal(updates.length, 1);
    assert.equal(updates[0]?.clientName, "Alessandro Paccini");
    assert.equal(updates[0]?.address, "Rua Comandante Marcondes Salgado 987");
    assert.equal(updates[0]?.phone, "16 3446 3522");
  });

  it("ignora frase sem endereço nem telefone", () => {
    assert.deepEqual(interpretContactUpdates("Amanhã coletar no doutor Rodrigo às cinco."), []);
  });
});
