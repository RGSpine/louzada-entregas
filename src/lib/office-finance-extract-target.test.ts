import test from "node:test";
import assert from "node:assert/strict";
import {
  extractTargetPromptBlock,
  parseOfficeFinanceExtractTarget,
} from "./office-finance-extract-target";

test("parseOfficeFinanceExtractTarget aceita alvos válidos", () => {
  assert.equal(parseOfficeFinanceExtractTarget("catalog"), "catalog");
  assert.equal(parseOfficeFinanceExtractTarget("invalid"), "auto");
});

test("extractTargetPromptBlock menciona PDF para catálogo", () => {
  const block = extractTargetPromptBlock("catalog");
  assert.match(block, /catalog_service/i);
  assert.match(block, /services/i);
  assert.match(block, /[Àà] vista/i);
  assert.match(block, /Crédito/i);
});
