import test from "node:test";
import assert from "node:assert/strict";
import {
  detectIosShell,
  iosShellLabel,
  isAppleMobileDevice,
  isInAppBrowser,
  isAppleMobileSafari,
  needsSafariAuthHardening,
  safariHandoffUrl,
} from "./ios-browser";

test("isAppleMobileDevice detecta iPhone/iPad", () => {
  assert.equal(
    isAppleMobileDevice(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    ),
    true,
  );
  assert.equal(
    isAppleMobileDevice(
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
    ),
    false,
  );
});

test("isInAppBrowser detecta WhatsApp / Instagram / Facebook", () => {
  assert.equal(
    isInAppBrowser(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/10.0.0",
    ),
    true,
  );
  assert.equal(
    isInAppBrowser(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 302.0.0",
    ),
    true,
  );
  assert.equal(
    isInAppBrowser(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/1.0]",
    ),
    true,
  );
  assert.equal(
    isInAppBrowser(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    ),
    false,
  );
});

test("isAppleMobileSafari distingue Safari de CriOS", () => {
  assert.equal(
    isAppleMobileSafari(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    ),
    true,
  );
  assert.equal(
    isAppleMobileSafari(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1",
    ),
    false,
  );
});

const SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

test("detectIosShell separa Safari, Chrome, Google e WhatsApp", () => {
  assert.equal(detectIosShell(SAFARI), "safari");
  assert.equal(
    detectIosShell(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1",
    ),
    "chrome",
  );
  assert.equal(
    detectIosShell(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/300.0 Mobile/15E148 Safari/604.1",
    ),
    "google",
  );
  assert.equal(
    detectIosShell(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/10.0.0",
    ),
    "in-app",
  );
  assert.equal(detectIosShell("Mozilla/5.0 (Linux; Android 14) Chrome/120.0.0.0"), null);
  assert.equal(iosShellLabel("google"), "Google");
});

test("safariHandoffUrl aponta a mesma página no Safari", () => {
  assert.equal(
    safariHandoffUrl("https://louzada.example/login?next=%2Fdashboard"),
    "x-safari-https://louzada.example/login?next=%2Fdashboard",
  );
  assert.equal(safariHandoffUrl("notaurl"), null);
});

test("needsSafariAuthHardening cobre iPhone e in-app", () => {
  assert.equal(
    needsSafariAuthHardening(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
    ),
    true,
  );
  assert.equal(
    needsSafariAuthHardening(
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
    ),
    false,
  );
  assert.equal(
    needsSafariAuthHardening(
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 WhatsApp",
    ),
    true,
  );
});
