import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { extractBearerToken } from "@/lib/auth/request-auth";

function req(headers: Record<string, string>) {
  return new NextRequest("http://localhost:3000/api/v1/me", { headers });
}

describe("extractBearerToken", () => {
  it("retorna null sem header Authorization", () => {
    assert.equal(extractBearerToken(req({})), null);
  });

  it("extrai token Bearer válido", () => {
    assert.equal(
      extractBearerToken(req({ authorization: "Bearer eyJ.test.token" })),
      "eyJ.test.token",
    );
  });

  it("aceita bearer case-insensitive", () => {
    assert.equal(
      extractBearerToken(req({ authorization: "bearer abc123" })),
      "abc123",
    );
  });

  it("rejeita esquema não-Bearer", () => {
    assert.equal(
      extractBearerToken(req({ authorization: "Basic dXNlcjpwYXNz" })),
      null,
    );
  });

  it("rejeita Bearer vazio", () => {
    assert.equal(extractBearerToken(req({ authorization: "Bearer   " })), null);
  });
});
