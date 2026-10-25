import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractJsonObject,
  historyImportAttachSchema,
  historyImportCommitSchema,
  historyImportPreviewSchema,
  parseImportSessionDate,
  sortHistoryImportSessions,
  validateHistoryImportFilesMeta,
} from "./patient-history-import";
import { MAX_HISTORY_IMPORT_FILES } from "./plan-limits";

describe("patient-history-import helpers", () => {
  it("validateHistoryImportFilesMeta rejeita lote vazio e acima do teto", () => {
    assert.equal(validateHistoryImportFilesMeta([]).ok, false);
    const tooMany = Array.from({ length: MAX_HISTORY_IMPORT_FILES + 1 }, (_, i) => ({
      size: 100,
      mimeType: "application/pdf",
      fileName: `f${i}.pdf`,
    }));
    assert.equal(validateHistoryImportFilesMeta(tooMany).ok, false);
  });

  it("validateHistoryImportFilesMeta aceita PDF válido", () => {
    const ok = validateHistoryImportFilesMeta([
      { size: 1024, mimeType: "application/pdf", fileName: "evo.pdf" },
    ]);
    assert.equal(ok.ok, true);
  });

  it("extractJsonObject lê JSON com cercas markdown", () => {
    const raw = extractJsonObject('```json\n{"patient":{"name":"Ana"},"sessions":[]}\n```');
    assert.deepEqual(raw, { patient: { name: "Ana" }, sessions: [] });
  });

  it("parseImportSessionDate usa data clínica ou hoje", () => {
    const d = parseImportSessionDate("2024-03-15");
    assert.equal(d.getFullYear(), 2024);
    assert.equal(d.getMonth(), 2);
    assert.equal(d.getDate(), 15);
  });

  it("historyImportPreviewSchema exige ao menos uma sessão", () => {
    const bad = historyImportPreviewSchema.safeParse({
      patient: { name: "Ana" },
      sessions: [],
    });
    assert.equal(bad.success, false);
    const good = historyImportPreviewSchema.safeParse({
      patient: { name: "Ana Silva" },
      sessions: [{ content: "Evolução clínica com conduta e exame físico." }],
    });
    assert.equal(good.success, true);

    const short = historyImportCommitSchema.safeParse({
      platform: "OUTRO",
      patient: { name: "Ana Silva" },
      sessions: [{ content: "muito curto" }],
    });
    assert.equal(short.success, false);

    const commitOk = historyImportCommitSchema.safeParse({
      platform: "OUTRO",
      patient: { name: "Ana Silva" },
      sessions: [{ content: "Evolução clínica com conduta e exame físico." }],
    });
    assert.equal(commitOk.success, true);
  });

  it("historyImportAttachSchema exige data YYYY-MM-DD em cada sessão", () => {
    const missingDate = historyImportAttachSchema.safeParse({
      patientId: "p1",
      platform: "OUTRO",
      sessions: [{ content: "Evolução clínica com conduta e exame físico." }],
    });
    assert.equal(missingDate.success, false);

    const ok = historyImportAttachSchema.safeParse({
      patientId: "p1",
      platform: "OUTRO",
      sessions: [
        {
          date: "2024-03-15",
          content: "Evolução clínica com conduta e exame físico.",
        },
      ],
    });
    assert.equal(ok.success, true);
  });

  it("sortHistoryImportSessions ordena por data e deixa sem data no fim", () => {
    const sorted = sortHistoryImportSessions([
      { date: "2024-06-01", content: "b" },
      { date: null, content: "c" },
      { date: "2024-01-10", content: "a" },
    ]);
    assert.deepEqual(
      sorted.map((s) => s.content),
      ["a", "b", "c"],
    );
  });
});
