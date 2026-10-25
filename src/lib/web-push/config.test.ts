import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("web-push / push cron config", () => {
  const prev = {
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
  };

  after(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("vercel.json agenda o cron de push às 11:00 UTC (08h BRT)", () => {
    const raw = readFileSync(join(process.cwd(), "vercel.json"), "utf8");
    const json = JSON.parse(raw) as {
      crons: { path: string; schedule: string }[];
    };
    const push = json.crons.find((c) => c.path === "/api/cron/push-notifications");
    assert.ok(push, "cron push-notifications deve existir");
    assert.equal(push!.schedule, "0 11 * * *");
  });

  it("isWebPushConfigured exige chave pública e privada", async () => {
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;

    const mod = await import("@/lib/web-push/config");
    assert.equal(mod.isWebPushConfigured(), false);

    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "BPublicTestKey";
    process.env.VAPID_PRIVATE_KEY = "PrivateTestKey";
    assert.equal(mod.isWebPushConfigured(), true);
    assert.equal(mod.getVapidPublicKey(), "BPublicTestKey");
    assert.equal(mod.getVapidPrivateKey(), "PrivateTestKey");
  });

  it("buildPushPayloadJson limita tamanho e define defaults", async () => {
    const { buildPushPayloadJson } = await import("@/lib/web-push/config");
    const parsed = JSON.parse(
      buildPushPayloadJson({
        title: "t".repeat(200),
        body: "b".repeat(600),
      }),
    ) as { title: string; body: string; url: string; icon: string };
    assert.equal(parsed.title.length, 120);
    assert.equal(parsed.body.length, 500);
    assert.equal(parsed.url, "/dashboard");
    assert.equal(parsed.icon, "/icons/icon-192.png");
  });
});

describe("push Meu Perfil wiring", () => {
  it("exporta PushNotificationsToggle e está em Meu Perfil (não no Menu Principal)", () => {
    const toggle = readFileSync(
      join(process.cwd(), "src/components/pwa/PushNotificationsToggle.tsx"),
      "utf8",
    );
    const profile = readFileSync(
      join(process.cwd(), "src/app/(b2b)/dashboard/profile/page.tsx"),
      "utf8",
    );
    const menu = readFileSync(
      join(process.cwd(), "src/app/(b2b)/dashboard/page.tsx"),
      "utf8",
    );
    assert.match(toggle, /export function PushNotificationsToggle/);
    assert.match(toggle, /id="notificacoes-push"/);
    assert.match(toggle, /role="switch"/);
    assert.match(profile, /PushNotificationsToggle/);
    assert.doesNotMatch(menu, /PushNotificationsToggle/);
    assert.match(
      readFileSync(
        join(process.cwd(), "src/components/dashboard/PatientEvolutionArtifacts.tsx"),
        "utf8",
      ),
      /\/dashboard\/profile#notificacoes-push/,
    );
  });
});
