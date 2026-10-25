import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyPercentDiscountCents,
  buildCouponPricePreview,
  formatBrlCentsForDisplay,
  parseBrlPriceToCents,
  parseCouponPercentFromCode,
} from "./coupon-display";

describe("parseCouponPercentFromCode", () => {
  it("extrai sufixo numérico", () => {
    assert.equal(parseCouponPercentFromCode("RGFISIO20"), 20);
    assert.equal(parseCouponPercentFromCode("rgfisio30"), 30);
    assert.equal(parseCouponPercentFromCode("PROMO15"), 15);
  });

  it("rejeita códigos sem percentual", () => {
    assert.equal(parseCouponPercentFromCode(""), null);
    assert.equal(parseCouponPercentFromCode("SEMNUMERO"), null);
    assert.equal(parseCouponPercentFromCode("ZERO0"), null);
  });
});

describe("buildCouponPricePreview", () => {
  it("aplica 20% em 49,90", () => {
    const preview = buildCouponPricePreview("49,90", 20);
    assert.equal(preview.original, "49,90");
    assert.equal(preview.discounted, "39,92");
    assert.equal(preview.percent, 20);
  });

  it("formata centavos corretamente", () => {
    assert.equal(formatBrlCentsForDisplay(4990), "49,90");
    assert.equal(parseBrlPriceToCents("478,80"), 47880);
    assert.equal(applyPercentDiscountCents(8780, 20), 7024);
  });
});
