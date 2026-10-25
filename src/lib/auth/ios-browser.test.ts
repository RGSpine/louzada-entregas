import test from "node:test";
import assert from "node:assert/strict";
import {
  isAppleMobileDevice,
  isInAppBrowser,
  isAppleMobileSafari,
  needsSafariAuthHardening,
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
