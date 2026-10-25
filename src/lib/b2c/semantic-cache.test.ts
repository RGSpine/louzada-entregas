import test from "node:test";
import assert from "node:assert/strict";
import {
  cosineTrigramSimilarity,
  searchSemanticCache,
  SEMANTIC_CACHE_THRESHOLD,
} from "./semantic-cache";
import {
  getCanonicalFaqSeedEntries,
  matchCanonicalProductFaq,
} from "./canonical-faq";

test("cosine: frase idêntica ≈ 1", () => {
  const s = cosineTrigramSimilarity(
    "como funciona o mapa de saude",
    "como funciona o mapa de saude",
  );
  assert.ok(s > 0.99);
});

test("cosine: quase-duplicata FAQ acima do limiar 0.90", () => {
  const s = cosineTrigramSimilarity(
    "como funciona o mapa de saude",
    "como funciona o mapa de saude?",
  );
  assert.ok(
    s >= SEMANTIC_CACHE_THRESHOLD,
    `score ${s} deveria ser >= ${SEMANTIC_CACHE_THRESHOLD}`,
  );
});

test("searchSemanticCache: seed 'como usar' também dá hit", async () => {
  const hit = await searchSemanticCache("como usar o mapa de saude");
  assert.ok(hit);
  assert.ok(hit!.score >= SEMANTIC_CACHE_THRESHOLD);
});

test("cosine: clínico ≠ FAQ produto", () => {
  const s = cosineTrigramSimilarity(
    "tenho dor lombar ha tres dias",
    "como funciona o mapa de saude",
  );
  assert.ok(s < 0.7, `score ${s} não deveria casar FAQ`);
});

test("searchSemanticCache: hit em seed sem Redis", async () => {
  const hit = await searchSemanticCache("Como funciona o mapa de saúde?");
  assert.ok(hit, "deveria achar seed");
  assert.ok(hit!.score >= SEMANTIC_CACHE_THRESHOLD);
  assert.equal(hit!.source, "seed");
  assert.ok(hit!.reply.toLowerCase().includes("mapa"));
});

test("searchSemanticCache: miss em sintoma clínico", async () => {
  const hit = await searchSemanticCache(
    "Estou com dor intensa no peito e formigamento no braço esquerdo agora",
  );
  assert.equal(hit, null);
});

test("FAQ expandido: seeds e match regex", () => {
  const seeds = getCanonicalFaqSeedEntries();
  assert.ok(seeds.length >= 20);
  assert.ok(matchCanonicalProductFaq("meus dados estao seguros"));
  assert.ok(matchCanonicalProductFaq("como adicionar dependente"));
  assert.ok(matchCanonicalProductFaq("trocar de perfil no mapa"));
});
