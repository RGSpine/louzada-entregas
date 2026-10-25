import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  attachMatchedTopics,
  buildFallbackQueriesFromProfileTags,
  matchRecommendationTopic,
} from "@/lib/clinical-chat/match-recommendation-topic";

const PROFILE = [
  "Tendinopatia",
  "Sindrome Miofascial",
  "Lombalgia",
  "Lesao Ligamentar",
  "Pos-Operatorio",
];

describe("matchRecommendationTopic", () => {
  it("casa tendinopathy com Tendinopatia (não Lombalgia)", () => {
    const topic = matchRecommendationTopic(
      {
        title: "Management of patellar tendinopathy: a systematic review",
        snippet: "Exercise therapy for Achilles and patellar tendinopathy",
      },
      PROFILE,
    );
    assert.equal(topic, "Tendinopatia");
  });

  it("casa myofascial com Sindrome Miofascial", () => {
    const topic = matchRecommendationTopic(
      {
        title: "Effectiveness of myofascial release on pain and quality of life",
        snippet: "Myofascial pain syndrome randomized trial",
      },
      PROFILE,
    );
    assert.equal(topic, "Sindrome Miofascial");
  });

  it("casa low back pain com Lombalgia", () => {
    const topic = matchRecommendationTopic(
      {
        title: "Nonpharmacologic therapies for low back pain",
        snippet: "Clinical practice guideline for lumbar pain",
      },
      PROFILE,
    );
    assert.equal(topic, "Lombalgia");
  });

  it("não força tag quando o artigo é genérico demais", () => {
    const topic = matchRecommendationTopic(
      {
        title: "Healthcare quality indicators overview",
        snippet: "Administrative metrics for clinics",
      },
      PROFILE,
    );
    assert.equal(topic, null);
  });
});

describe("attachMatchedTopics", () => {
  it("não rotaciona tags por índice quando o título aponta outro tema", () => {
    const items = attachMatchedTopics(
      [
        {
          title: "TENDINOPATHY CLINICAL PRACTICE GUIDELINE",
          snippet: "Load management for tendinopathy",
        },
        {
          title: "Clinical management of tendinopathy systematic review",
          snippet: null,
        },
      ],
      ["myofascial pain syndrome physiotherapy", "tendinopathy guidelines"],
      PROFILE,
    );
    assert.equal(items[0]?.matchedTopic, "Tendinopatia");
    assert.equal(items[1]?.matchedTopic, "Tendinopatia");
  });
});

describe("buildFallbackQueriesFromProfileTags", () => {
  it("gera queries em inglês alinhadas às tags", () => {
    const qs = buildFallbackQueriesFromProfileTags(
      ["Tendinopatia", "Lombalgia", "Sindrome Miofascial"],
      3,
    );
    assert.equal(qs.length, 3);
    assert.match(qs[0]!.toLowerCase(), /tendinopathy/);
    assert.match(qs[1]!.toLowerCase(), /low back pain|lumbar/);
    assert.match(qs[2]!.toLowerCase(), /myofascial/);
  });
});
