import test from "node:test";
import assert from "node:assert/strict";
import {
  googleDisplayName,
  isProfessionalProfileComplete,
} from "./google-profile";

test("isProfessionalProfileComplete exige o nome e dispensa profissão e conselho", () => {
  assert.equal(isProfessionalProfileComplete({ name: "Suzana" }), true);
  assert.equal(
    isProfessionalProfileComplete({
      name: "Suzana",
      profession: null,
      councilType: null,
      councilNumber: null,
    }),
    true,
  );
  assert.equal(isProfessionalProfileComplete({ name: "  " }), false);
});

test("googleDisplayName lê metadados do Google", () => {
  assert.equal(googleDisplayName({ full_name: "Roberto Guanaes" }), "Roberto Guanaes");
  assert.equal(googleDisplayName({ name: "Ana" }), "Ana");
});
