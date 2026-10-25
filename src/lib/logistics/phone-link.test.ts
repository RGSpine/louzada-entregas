import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { phoneCallHref } from "@/lib/logistics/phone-link";

describe("ligação", () => {
  it("monta a chamada com DDD e ignora texto sem número", () => {
    assert.equal(phoneCallHref("11 98888-7766"), "tel:+5511988887766");
    assert.equal(phoneCallHref("+55 16 3446 3522"), "tel:+551634463522");
    assert.equal(phoneCallHref("3446-3522"), "tel:34463522");
    assert.equal(phoneCallHref(""), null);
    assert.equal(phoneCallHref("sem telefone"), null);
  });
});
