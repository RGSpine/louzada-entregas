import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isB2bProtectedPath,
  isB2cAuthPath,
  isB2cPublicPath,
  patientLoginHref,
  safeMarketplaceRedirect,
} from "@/lib/marketplace/paths";

describe("marketplace paths", () => {
  it("B2C público cobre busca, vitrine, cadastro e landing/login paciente", () => {
    assert.equal(isB2cPublicPath("/buscar"), true);
    assert.equal(isB2cPublicPath("/vitrine"), true);
    assert.equal(isB2cPublicPath("/cadastro-paciente"), true);
    assert.equal(isB2cPublicPath("/paciente"), true);
    assert.equal(isB2cPublicPath("/paciente/login"), true);
    assert.equal(isB2cPublicPath("/reservar"), false);
    assert.equal(isB2cPublicPath("/mapa-saude"), false);
    assert.equal(isB2cPublicPath("/dashboard"), false);
  });

  it("reserva e mapa de saúde B2C exigem login", () => {
    assert.equal(isB2cAuthPath("/reservar"), true);
    assert.equal(isB2cAuthPath("/mapa-saude"), true);
    assert.equal(isB2cAuthPath("/buscar"), false);
    assert.equal(isB2cAuthPath("/vitrine"), false);
  });

  it("B2B protegido cobre dashboard e admin", () => {
    assert.equal(isB2bProtectedPath("/dashboard/gestao-inteligente"), true);
    assert.equal(isB2bProtectedPath("/admin"), true);
    assert.equal(isB2bProtectedPath("/buscar"), false);
    assert.equal(isB2bProtectedPath("/mapa-saude"), false);
  });

  it("safeMarketplaceRedirect bloqueia open redirect", () => {
    assert.equal(safeMarketplaceRedirect("/buscar"), "/buscar");
    assert.equal(safeMarketplaceRedirect("/vitrine"), "/vitrine");
    assert.equal(safeMarketplaceRedirect("/mapa-saude"), "/mapa-saude");
    assert.equal(safeMarketplaceRedirect("/paciente/login"), "/paciente/login");
    assert.equal(safeMarketplaceRedirect("/reservar?slot=abc"), "/reservar?slot=abc");
    assert.equal(safeMarketplaceRedirect("//evil.example"), null);
    assert.equal(safeMarketplaceRedirect("https://evil.example"), null);
    assert.equal(safeMarketplaceRedirect("/dashboard"), null);
  });

  it("patientLoginHref monta login paciente com redirect seguro", () => {
    assert.equal(patientLoginHref(null), "/paciente/login");
    assert.equal(
      patientLoginHref("/mapa-saude"),
      "/paciente/login?redirect=%2Fmapa-saude",
    );
    assert.equal(patientLoginHref("https://evil.example"), "/paciente/login");
  });
});
