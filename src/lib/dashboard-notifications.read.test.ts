import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mergeDashboardInboxReadIds,
  parseDashboardInboxReadIds,
} from "@/lib/dashboard-notifications";

describe("dashboard inbox read ids", () => {
  it("parse ignora valores inválidos", () => {
    assert.deepEqual(parseDashboardInboxReadIds(null), []);
    assert.deepEqual(parseDashboardInboxReadIds(["a", 1, "", "b"]), ["a", "b"]);
  });

  it("merge deduplica e limita tamanho", () => {
    const existing = ["a", "b"];
    const merged = mergeDashboardInboxReadIds(existing, ["b", "c"]);
    assert.deepEqual(merged, ["a", "b", "c"]);
  });
});
