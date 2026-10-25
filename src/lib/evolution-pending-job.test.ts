import assert from "node:assert/strict";
import test from "node:test";
import {
  clearPendingEvolutionJob,
  EVOLUTION_PENDING_JOB_STORAGE_KEY,
  loadPendingEvolutionJob,
  savePendingEvolutionJob,
} from "@/lib/evolution-pending-job";

test("save/load/clear pending evolution job", () => {
  const storage = new Map<string, string>();
  (globalThis as { sessionStorage: Storage }).sessionStorage = {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => {
      storage.set(k, v);
    },
    removeItem: (k) => {
      storage.delete(k);
    },
    clear: () => storage.clear(),
    key: () => null,
    length: 0,
  } as Storage;

  try {
    savePendingEvolutionJob({
      jobId: "job_test_1",
      createdAt: new Date().toISOString(),
      patientId: "pat-1",
      source: "main",
    });
    const loaded = loadPendingEvolutionJob();
    assert.ok(loaded);
    assert.equal(loaded?.jobId, "job_test_1");
    assert.equal(loaded?.source, "main");
    clearPendingEvolutionJob();
    assert.equal(loadPendingEvolutionJob(), null);
    assert.equal(storage.has(EVOLUTION_PENDING_JOB_STORAGE_KEY), false);
  } finally {
    delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
  }
});
