import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clientIpFromHeaders,
  getMaxConcurrentSessionsForPlan,
  isLastLoginWinsSessionPlan,
  isWinningAccessSession,
} from "@/lib/access-session";
import { ADMIN_EMAIL } from "@/lib/plan-limits";

describe("getMaxConcurrentSessionsForPlan", () => {
  it("limita planos individuais a 1 sessão", () => {
    assert.equal(getMaxConcurrentSessionsForPlan("PREMIUM", "outro@email.com", false), 1);
    assert.equal(getMaxConcurrentSessionsForPlan("PROFISSIONAL", null, false), 1);
    assert.equal(getMaxConcurrentSessionsForPlan("BASICO", null, false), 1);
  });

  it("concede sessões ilimitadas ao e-mail do dono da plataforma", () => {
    assert.equal(
      getMaxConcurrentSessionsForPlan("PREMIUM", ADMIN_EMAIL, false),
      Number.POSITIVE_INFINITY,
    );
    assert.equal(
      getMaxConcurrentSessionsForPlan("BASICO", ADMIN_EMAIL, false),
      Number.POSITIVE_INFINITY,
    );
  });

  it("permite múltiplas sessões em planos clínica", () => {
    assert.equal(getMaxConcurrentSessionsForPlan("CONSULTORIO", null, false), 5);
    assert.equal(getMaxConcurrentSessionsForPlan("CLINICA", null, false), 10);
  });

  it("não aplica teto individual a NONE/PENDING/null (checkout pendente)", () => {
    assert.equal(getMaxConcurrentSessionsForPlan("NONE", null, false), Number.POSITIVE_INFINITY);
    assert.equal(getMaxConcurrentSessionsForPlan("PENDING", null, false), Number.POSITIVE_INFINITY);
    assert.equal(getMaxConcurrentSessionsForPlan(null, null, false), Number.POSITIVE_INFINITY);
    assert.equal(getMaxConcurrentSessionsForPlan("", null, false), Number.POSITIVE_INFINITY);
  });

  it("influencer no plano individual também tem 1 aparelho", () => {
    assert.equal(getMaxConcurrentSessionsForPlan("PREMIUM", null, true), 1);
    assert.equal(getMaxConcurrentSessionsForPlan("BASICO", "parceiro@email.com", true), 1);
    assert.equal(getMaxConcurrentSessionsForPlan("PROFISSIONAL", null, true), 1);
    assert.equal(isLastLoginWinsSessionPlan(1), true);
    assert.equal(isLastLoginWinsSessionPlan(5), false);
  });

  it("influencer em Consultório/Clínica mantém teto de equipe", () => {
    assert.equal(getMaxConcurrentSessionsForPlan("CONSULTORIO", null, true), 5);
    assert.equal(getMaxConcurrentSessionsForPlan("CLINICA", null, true), 10);
  });
});

describe("clientIpFromHeaders", () => {
  it("usa o primeiro hop de x-forwarded-for", () => {
    const headers = {
      get(name: string) {
        if (name === "x-forwarded-for") return "201.17.8.9, 10.0.0.1";
        return null;
      },
    };
    assert.equal(clientIpFromHeaders(headers), "201.17.8.9");
  });
});

describe("isWinningAccessSession", () => {
  it("com lastSeenAt idêntico, só uma sessão vence (createdAt + id)", () => {
    const t = new Date("2026-09-24T17:00:00.000Z");
    const older = {
      id: "claaa",
      lastSeenAt: t,
      createdAt: new Date("2026-09-24T16:59:59.000Z"),
    };
    const newer = {
      id: "clzzz",
      lastSeenAt: t,
      createdAt: t,
    };
    assert.equal(isWinningAccessSession(newer, [older]), true);
    assert.equal(isWinningAccessSession(older, [newer]), false);
  });

  it("com lastSeenAt e createdAt idênticos, o id maior vence — nunca os dois", () => {
    const t = new Date("2026-09-24T17:00:00.000Z");
    const a = { id: "aaa", lastSeenAt: t, createdAt: t };
    const b = { id: "zzz", lastSeenAt: t, createdAt: t };
    assert.equal(isWinningAccessSession(a, [b]), false);
    assert.equal(isWinningAccessSession(b, [a]), true);
  });
});

describe("janela de concorrência", () => {
  it("usa janela curta (tempo real), não semanas", async () => {
    const mod = await import("@/lib/access-session");
    assert.equal(mod.ACCESS_SESSION_CONCURRENT_MS, 10 * 60 * 1000);
    assert.ok(mod.ACCESS_SESSION_CONCURRENT_MS < 60 * 60 * 1000);
  });
});
