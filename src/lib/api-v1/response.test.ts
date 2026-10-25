import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  API_V1_VERSION,
  apiV1AuthError,
  apiV1Error,
  apiV1Ok,
} from "@/lib/api-v1/response";
import type { AuthFailureReason } from "@/lib/auth/request-auth";

describe("apiV1Ok", () => {
  it("retorna envelope {ok:true, data, meta.apiVersion} com status 200", async () => {
    const res = apiV1Ok({ hello: "world" });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, {
      ok: true,
      data: { hello: "world" },
      meta: { apiVersion: API_V1_VERSION },
    });
  });

  it("aceita status customizado (201 em criação)", async () => {
    const res = apiV1Ok({ id: "abc" }, { status: 201 });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.data.id, "abc");
  });

  it("serializa data nula/primitiva mantendo o envelope", async () => {
    const res = apiV1Ok(null);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.data, null);
    assert.equal(body.meta.apiVersion, API_V1_VERSION);
  });
});

describe("apiV1Error", () => {
  it("retorna envelope {ok:false, error:{code,message}} com status 400 por omissão", async () => {
    const res = apiV1Error("INVALID_JSON", "Corpo JSON inválido.");
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.deepEqual(body, {
      ok: false,
      error: { code: "INVALID_JSON", message: "Corpo JSON inválido." },
      meta: { apiVersion: API_V1_VERSION },
    });
  });

  it("aceita status customizado (409 para conflito de agenda)", async () => {
    const res = apiV1Error("SCHEDULE_CONFLICT", "Horário indisponível.", 409);
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "SCHEDULE_CONFLICT");
  });

  it("aceita 429 para rate limit", async () => {
    const res = apiV1Error("RATE_LIMITED", "Muitas requisições.", 429);
    assert.equal(res.status, 429);
    const body = await res.json();
    assert.equal(body.error.code, "RATE_LIMITED");
  });
});

describe("apiV1AuthError — mapeamento reason → código/status", () => {
  const cases: Array<{
    reason: AuthFailureReason;
    code: string;
    status: number;
  }> = [
    { reason: "missing_credentials", code: "UNAUTHORIZED", status: 401 },
    { reason: "invalid_token", code: "INVALID_TOKEN", status: 401 },
    { reason: "user_not_found", code: "USER_NOT_FOUND", status: 401 },
    { reason: "account_blocked", code: "ACCOUNT_BLOCKED", status: 403 },
    { reason: "access_limit_exceeded", code: "ACCESS_LIMIT_EXCEEDED", status: 403 },
    { reason: "access_session_invalid", code: "ACCESS_SESSION_INVALID", status: 401 },
  ];

  for (const { reason, code, status } of cases) {
    it(`${reason} → ${status} ${code}`, async () => {
      const res = apiV1AuthError(reason);
      assert.equal(res.status, status);
      const body = await res.json();
      assert.equal(body.ok, false);
      assert.equal(body.error.code, code);
      assert.ok(typeof body.error.message === "string" && body.error.message.length > 0);
      assert.equal(body.meta.apiVersion, API_V1_VERSION);
    });
  }
});
