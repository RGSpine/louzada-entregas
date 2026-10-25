import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canUseServiceSpaces,
  maxServiceSpacesForPlan,
  parseServiceSpaceViewParam,
  serviceSpaceWhere,
  assertValidServiceSpaceColor,
} from "@/lib/service-spaces/access";
import { normalizePlanTier } from "@/lib/plan-tier";

describe("canUseServiceSpaces", () => {
  it("só CONSULTORIO e CLINICA", () => {
    assert.equal(canUseServiceSpaces("CONSULTORIO"), true);
    assert.equal(canUseServiceSpaces("CLINICA"), true);
    assert.equal(canUseServiceSpaces("PREMIUM"), false);
    assert.equal(canUseServiceSpaces("PROFISSIONAL"), false);
    assert.equal(canUseServiceSpaces("BASICO"), false);
    assert.equal(canUseServiceSpaces(null), false);
  });

  it("influencer não herda espaços", () => {
    assert.equal(canUseServiceSpaces("CLINICA", null, true), false);
  });
});

describe("maxServiceSpacesForPlan", () => {
  it("tetos por plano", () => {
    assert.equal(maxServiceSpacesForPlan(normalizePlanTier("CONSULTORIO")), 8);
    assert.equal(maxServiceSpacesForPlan(normalizePlanTier("CLINICA")), 30);
    assert.equal(maxServiceSpacesForPlan(normalizePlanTier("PREMIUM")), 0);
  });
});

describe("serviceSpaceWhere", () => {
  it("all = sem filtro", () => {
    assert.equal(serviceSpaceWhere("all"), undefined);
  });

  it("espaço inclui geral por omissão", () => {
    assert.deepEqual(serviceSpaceWhere({ spaceId: "sp1" }), {
      OR: [{ serviceSpaceId: "sp1" }, { serviceSpaceId: null }],
    });
  });

  it("espaço estrito", () => {
    assert.deepEqual(serviceSpaceWhere({ spaceId: "sp1" }, { includeGeneral: false }), {
      serviceSpaceId: "sp1",
    });
  });
});

describe("parse + cor", () => {
  it("parse all", () => {
    assert.equal(parseServiceSpaceViewParam("all"), "all");
    assert.equal(parseServiceSpaceViewParam(null), "all");
  });

  it("cor HEX", () => {
    assert.equal(assertValidServiceSpaceColor("#0f766e"), "#0F766E");
    assert.equal(assertValidServiceSpaceColor("nope"), null);
  });
});
