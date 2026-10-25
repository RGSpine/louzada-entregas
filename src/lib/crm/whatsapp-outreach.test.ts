import assert from "node:assert/strict";
import {
  buildCrmWhatsAppOutreachUrl,
  normalizeBrazilWhatsAppDigits,
} from "@/lib/crm/whatsapp-outreach";

assert.equal(normalizeBrazilWhatsAppDigits("(16) 99275-6619"), "5516992756619");
assert.equal(normalizeBrazilWhatsAppDigits("16992756619"), "5516992756619");
assert.equal(normalizeBrazilWhatsAppDigits("5516992756619"), "5516992756619");
assert.equal(normalizeBrazilWhatsAppDigits("016992756619"), "5516992756619");
assert.equal(normalizeBrazilWhatsAppDigits(null), null);
assert.equal(normalizeBrazilWhatsAppDigits("123"), null);

const ok = buildCrmWhatsAppOutreachUrl({
  phone: "16 99275-6619",
  text: "Oi!",
});
assert.equal(ok.ok, true);
if (ok.ok) {
  assert.ok(ok.url.startsWith("https://wa.me/5516992756619?text="));
}

const bad = buildCrmWhatsAppOutreachUrl({ phone: null, text: "Oi" });
assert.equal(bad.ok, false);

console.log("crm whatsapp-outreach tests ok");
