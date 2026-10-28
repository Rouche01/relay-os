import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SpecV2Body } from "@relay/protocol";
import { lowerSpecV2 } from "@relay/spec-lower";
import { compileEvals } from "../src/index.js";

function sample(): SpecV2Body {
  return {
    goal: "Help fashion subs",
    budget: { dryRun: true, maxJobs: 2 },
    rules: [
      {
        id: "no_promo_links",
        kind: "hard",
        check: { notMatches: "${draft.text}", pattern: "https?://" },
      },
      {
        id: "helpful_reply",
        kind: "soft",
        judge: { rubric: ["threadFit", "soundsHuman"], minMean: 3.5 },
      },
      {
        id: "earns_engagement",
        kind: "outcome",
        metric: { name: "comment_score", after: "48h", min: 2 },
      },
      {
        id: "orphan_hard",
        kind: "hard",
        check: { eq: "${x}", value: 1 },
      },
    ],
    steps: [
      {
        id: "draft",
        use: "llm.generate",
        args: { prompt: "Draft" },
        enforce: ["no_promo_links", "helpful_reply"],
      },
    ],
  };
}

describe("compileEvals", () => {
  it("indexes enforce + outcome stubs + uncovered", () => {
    const suite = compileEvals(sample());
    assert.equal(suite.evals.length, 4);
    assert.deepEqual(
      suite.evals.find((e) => e.ruleId === "no_promo_links")?.enforcedBy,
      ["draft"]
    );
    assert.equal(suite.outcomes.length, 1);
    assert.equal(suite.outcomes[0]?.ruleId, "earns_engagement");
    assert.deepEqual(suite.uncovered, ["orphan_hard"]);
  });

  it("carries specHash from lowered workflow", () => {
    const lowered = lowerSpecV2(sample());
    const suite = compileEvals(lowered);
    assert.equal(suite.specHash, lowered.specHash);
  });
});
