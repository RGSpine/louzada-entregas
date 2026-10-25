import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clinicalProfileFingerprint } from "@/lib/clinical-chat/clinical-profile-fingerprint";
import type { ClinicalProfileSnapshot } from "@/lib/clinical-chat/clinical-profile-snapshot";

describe("clinicalProfileFingerprint", () => {
  it("muda quando o top do perfil muda", () => {
    const a: ClinicalProfileSnapshot = {
      topTags: [
        { tag: "Tendinopatia", count: 13 },
        { tag: "Lombalgia", count: 5 },
      ],
      totalTags: 20,
      mostFrequentTag: "Tendinopatia",
      monthTagCount: 4,
    };
    const b: ClinicalProfileSnapshot = {
      ...a,
      topTags: [
        { tag: "Tendinopatia", count: 14 },
        { tag: "Lombalgia", count: 5 },
      ],
      totalTags: 21,
    };
    assert.notEqual(clinicalProfileFingerprint(a), clinicalProfileFingerprint(b));
  });

  it("é estável para a mesma ordenação de tags", () => {
    const a: ClinicalProfileSnapshot = {
      topTags: [
        { tag: "Lombalgia", count: 5 },
        { tag: "Tendinopatia", count: 13 },
      ],
      totalTags: 18,
      mostFrequentTag: "Tendinopatia",
      monthTagCount: 2,
    };
    const b: ClinicalProfileSnapshot = {
      topTags: [
        { tag: "Tendinopatia", count: 13 },
        { tag: "Lombalgia", count: 5 },
      ],
      totalTags: 18,
      mostFrequentTag: "Tendinopatia",
      monthTagCount: 2,
    };
    assert.equal(clinicalProfileFingerprint(a), clinicalProfileFingerprint(b));
  });
});
