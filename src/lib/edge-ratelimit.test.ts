import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";
import {
  extractSupabaseUserIdFromCookies,
  getClientIp,
  isAiRateLimitedPath,
  isAuthRateLimitedPath,
  isGeneralApiPath,
  isMarketplaceB2cPath,
  isMutatingMethod,
  mustFailClosedCritical,
} from "@/lib/edge-ratelimit";

describe("edge-ratelimit path classification", () => {
  it("auth: limita /api/auth em qualquer método", () => {
    assert.equal(isAuthRateLimitedPath("/api/auth/exchange", "GET"), true);
    assert.equal(isAuthRateLimitedPath("/api/auth/refresh", "POST"), true);
  });

  it("auth: páginas só em métodos mutantes", () => {
    assert.equal(isAuthRateLimitedPath("/login", "GET"), false);
    assert.equal(isAuthRateLimitedPath("/login", "POST"), true);
    assert.equal(isAuthRateLimitedPath("/paciente/login", "GET"), false);
    assert.equal(isAuthRateLimitedPath("/paciente/login", "POST"), true);
    assert.equal(isAuthRateLimitedPath("/register", "POST"), true);
    assert.equal(isAuthRateLimitedPath("/forgot-password", "POST"), true);
  });

  it("auth: não pega rotas não relacionadas", () => {
    assert.equal(isAuthRateLimitedPath("/dashboard", "POST"), false);
    assert.equal(isAuthRateLimitedPath("/api/evolution", "POST"), false);
  });

  it("ai: cobre endpoints de custo e exclui polling", () => {
    assert.equal(isAiRateLimitedPath("/api/evolution"), true);
    assert.equal(isAiRateLimitedPath("/api/evolution/jobs/abc"), false);
    assert.equal(isAiRateLimitedPath("/api/evolution/jobs/active"), false);
    assert.equal(isAiRateLimitedPath("/api/clinical-chat"), true);
    assert.equal(isAiRateLimitedPath("/api/metrics/generate"), true);
    assert.equal(isAiRateLimitedPath("/api/finance-agent"), true);
    assert.equal(isAiRateLimitedPath("/api/finance-agent/jobs/xyz"), false);
    assert.equal(isAiRateLimitedPath("/api/office-finance/extract"), true);
    assert.equal(isAiRateLimitedPath("/api/stripe/checkout"), true);
    assert.equal(
      isAiRateLimitedPath("/api/patients/cuid123/metrics/auto-generate"),
      true,
    );
    assert.equal(isAiRateLimitedPath("/api/patients/cuid123"), false);
  });

  it("api geral: só /api/*", () => {
    assert.equal(isGeneralApiPath("/api/health"), true);
    assert.equal(isGeneralApiPath("/dashboard"), false);
  });

  it("marketplace B2C: /buscar, /vitrine e mapa (GET scrape e POST action)", () => {
    assert.equal(isMarketplaceB2cPath("/buscar"), true);
    assert.equal(isMarketplaceB2cPath("/buscar/"), true);
    assert.equal(isMarketplaceB2cPath("/vitrine"), true);
    assert.equal(isMarketplaceB2cPath("/mapa-saude"), true);
    assert.equal(isMarketplaceB2cPath("/reservar"), true);
    assert.equal(isMarketplaceB2cPath("/cadastro-paciente"), true);
    assert.equal(isMarketplaceB2cPath("/dashboard"), false);
    assert.equal(isMarketplaceB2cPath("/api/health"), false);
  });

  it("mutating helpers", () => {
    assert.equal(isMutatingMethod("GET"), false);
    assert.equal(isMutatingMethod("POST"), true);
    assert.equal(isMutatingMethod("PATCH"), true);
  });
});

describe("edge-ratelimit getClientIp", () => {
  it("prefere x-real-ip", () => {
    const req = new NextRequest("https://aievolui.com.br/api/health", {
      headers: {
        "x-real-ip": "203.0.113.10",
        "x-forwarded-for": "1.2.3.4, 5.6.7.8",
      },
    });
    assert.equal(getClientIp(req), "203.0.113.10");
  });

  it("usa primeiro hop de x-vercel-forwarded-for", () => {
    const req = new NextRequest("https://aievolui.com.br/api/health", {
      headers: {
        "x-vercel-forwarded-for": "198.51.100.1, 10.0.0.1",
      },
    });
    assert.equal(getClientIp(req), "198.51.100.1");
  });

  it("fallback 127.0.0.1 sem headers", () => {
    const req = new NextRequest("https://aievolui.com.br/api/health");
    assert.equal(getClientIp(req), "127.0.0.1");
  });
});

describe("edge-ratelimit fail-closed policy", () => {
  it("mustFailClosedCritical segue VERCEL_ENV/NODE_ENV", () => {
    const prevVercel = process.env.VERCEL_ENV;
    const prevNode = process.env.NODE_ENV;
    try {
      process.env.VERCEL_ENV = "production";
      process.env.NODE_ENV = "production";
      assert.equal(mustFailClosedCritical(), true);

      process.env.VERCEL_ENV = "preview";
      process.env.NODE_ENV = "development";
      assert.equal(mustFailClosedCritical(), false);
    } finally {
      if (prevVercel === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = prevVercel;
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
    }
  });
});

describe("edge-ratelimit extractSupabaseUserIdFromCookies", () => {
  it("extrai sub de cookie base64- JSON com JWT", () => {
    const header = Buffer.from(
      JSON.stringify({ alg: "none", typ: "JWT" }),
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        sub: "user-test-uuid-123",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url");
    const accessToken = `${header}.${payload}.sig`;
    const session = Buffer.from(
      JSON.stringify({ access_token: accessToken }),
    ).toString("base64url");

    const req = new NextRequest("https://aievolui.com.br/api/evolution", {
      headers: {
        cookie: `sb-xxx-auth-token=base64-${session}`,
      },
    });
    assert.equal(extractSupabaseUserIdFromCookies(req), "user-test-uuid-123");
  });

  it("ignora JWT expirado", () => {
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        sub: "expired-user",
        exp: Math.floor(Date.now() / 1000) - 10,
      }),
    ).toString("base64url");
    const accessToken = `${header}.${payload}.sig`;
    const session = Buffer.from(
      JSON.stringify({ access_token: accessToken }),
    ).toString("base64url");

    const req = new NextRequest("https://aievolui.com.br/api/evolution", {
      headers: {
        cookie: `sb-xxx-auth-token=base64-${session}`,
      },
    });
    assert.equal(extractSupabaseUserIdFromCookies(req), null);
  });
});
