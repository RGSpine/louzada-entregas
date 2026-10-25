import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isNfseEligibleStoredPlan,
  isNfseLegacyDevEnabled,
  isNfseOrgTokenConfigured,
  isNfsePublicEnabled,
  isNfseServerEmitAllowed,
  isNfseUserFacingActive,
  shouldShowNfseComingSoon,
} from "@/lib/fiscal/nfse-feature-flags";

describe("nfse-feature-flags", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it("identifica planos elegíveis", () => {
    assert.equal(isNfseEligibleStoredPlan("PREMIUM"), true);
    assert.equal(isNfseEligibleStoredPlan("CONSULTORIO"), true);
    assert.equal(isNfseEligibleStoredPlan("CLINICA"), true);
    assert.equal(isNfseEligibleStoredPlan("BASICO"), false);
    assert.equal(isNfseEligibleStoredPlan("PROFISSIONAL"), false);
  });

  it("mostra em breve quando plano elegível e público desligado", () => {
    process.env.FISCAL_NFSE_PUBLIC_ENABLED = "false";
    assert.equal(shouldShowNfseComingSoon("PREMIUM"), true);
    assert.equal(shouldShowNfseComingSoon("BASICO"), false);
  });

  it("activa UI quando público ligado", () => {
    process.env.FISCAL_NFSE_PUBLIC_ENABLED = "true";
    assert.equal(isNfseUserFacingActive("PREMIUM"), true);
    assert.equal(shouldShowNfseComingSoon("PREMIUM"), false);
  });

  it("permite emissão legacy dev sem expor UI", () => {
    process.env.FISCAL_NFSE_PUBLIC_ENABLED = "false";
    process.env.FISCAL_NFSE_LEGACY_DEV = "true";
    assert.equal(isNfsePublicEnabled(), false);
    assert.equal(isNfseLegacyDevEnabled(), true);
    assert.equal(isNfseServerEmitAllowed(), true);
    assert.equal(isNfseUserFacingActive("PREMIUM"), false);
  });

  it("valida prefixo org token", () => {
    process.env.NOTAAS_ORG_TOKEN = "ntaas_org_abc";
    assert.equal(isNfseOrgTokenConfigured(), true);
    process.env.NOTAAS_ORG_TOKEN = "invalid";
    assert.equal(isNfseOrgTokenConfigured(), false);
  });
});
