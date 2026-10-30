import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SpecV2Body } from "@relay/protocol";
import {
  assertEvalsGate,
  generateEvalFixtures,
  hasEvaluableFixtures,
  runEvals,
} from "../src/index.js";

function engageLiteLike(): SpecV2Body {
  return {
    goal: "Help fashion subreddits with useful replies",
    budget: { dryRun: true, maxJobs: 2 },
    rules: [
      {
        id: "allowlist_only",
        kind: "hard",
        check: {
          in: "${item.subreddit}",
          list: ["malefashionadvice", "femalefashionadvice"],
        },
      },
      {
        id: "no_promo_links",
        kind: "hard",
        check: { notMatches: "${draft.text}", pattern: "https?://" },
      },
    ],
    steps: [
      {
        id: "draft",
        use: "llm.generate",
        args: { prompt: "Draft a reply" },
        enforce: ["no_promo_links", "allowlist_only"],
      },
    ],
  };
}

describe("generateEvalFixtures", () => {
  it("emits acceptance + counterexample cases", () => {
    const pack = generateEvalFixtures(engageLiteLike());
    assert.ok(hasEvaluableFixtures(pack));
    const ids = pack.cases.map((c) => c.id);
    assert.ok(ids.includes("acceptance_good"));
    assert.ok(ids.includes("counter_promo"));
    assert.ok(ids.includes("counter_allowlist"));
  });

  it("passes runEvals gate on generated fixtures", async () => {
    const spec = engageLiteLike();
    const pack = generateEvalFixtures(spec);
    const report = await runEvals({
      spec,
      softFailClosed: false,
      fixtures: pack,
    });
    assert.equal(report.passed, true, JSON.stringify(report.errors));
    assert.doesNotThrow(() => assertEvalsGate(report));
  });
});
