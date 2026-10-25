/**
 * Unit tests — PIN ADMIN (formato + hash/verify).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  adminPinFormatError,
  hashAdminPin,
  intraUserRequiresPin,
  isValidAdminPinFormat,
  verifyAdminPin,
} from "@/lib/intra-user/pin";

describe("admin PIN format", () => {
  it("aceita 4–6 dígitos", () => {
    assert.equal(isValidAdminPinFormat("1234"), true);
    assert.equal(isValidAdminPinFormat("123456"), true);
  });

  it("rejeita letras, curtos e longos", () => {
    assert.equal(isValidAdminPinFormat("123"), false);
    assert.equal(isValidAdminPinFormat("1234567"), false);
    assert.equal(isValidAdminPinFormat("12ab"), false);
    assert.equal(isValidAdminPinFormat(""), false);
  });
});

describe("admin PIN hash/verify", () => {
  it("verifica PIN correto e rejeita incorreto", async () => {
    const hash = await hashAdminPin("482916");
    assert.match(hash, /^scrypt\$/);
    assert.equal(await verifyAdminPin("482916", hash), true);
    assert.equal(await verifyAdminPin("0000", hash), false);
    assert.equal(await verifyAdminPin("482916", null), false);
  });

  it("hashAdminPin rejeita formato inválido", async () => {
    await assert.rejects(() => hashAdminPin("abc"), /PIN/);
    assert.match(adminPinFormatError(), /dígitos/);
  });
});

describe("intraUserRequiresPin", () => {
  it("só ADMIN exige PIN (Opção B)", () => {
    assert.equal(intraUserRequiresPin("ADMIN"), true);
    assert.equal(intraUserRequiresPin("MEMBER"), false);
  });
});
