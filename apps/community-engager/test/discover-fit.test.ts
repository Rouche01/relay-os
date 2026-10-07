import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HeuristicDecisionBackend,
  wrapBackend,
} from "@relay/engines-decide";
import {
  DISCOVER_FIT_DROP_BELOW,
  buildDiscoverFitRequest,
  interpretDiscoverFit,
  scoreDiscoverFit,
} from "../src/discover-fit.js";

describe("buildDiscoverFitRequest", () => {
  it("puts goal, bio, and optional sample titles in state", () => {
    const req = buildDiscoverFitRequest(
      {
        name: "femalefashionadvice",
        title: "FFA",
        publicDescription: "Advice for women's fashion",
        subscribers: 1_000_000,
        sampleTitles: ["How do I build a capsule?"],
        goal: "help-first styling",
      },
      0.8
    );
    assert.equal(req.meta?.kind, "discover");
    assert.equal(req.policy?.minConfidence, 0.8);
    assert.equal(req.questions.length, 2);
    assert.equal(req.questions[0]?.kind, "noul");
    assert.equal(req.questions[1]?.id, "rules");
    const state = req.state as Record<string, unknown>;
    assert.equal(state.goal, "help-first styling");
    assert.equal(state.subreddit, "femalefashionadvice");
    assert.deepEqual(state.sampleTitles, ["How do I build a capsule?"]);
  });
});

describe("interpretDiscoverFit", () => {
  it("proposes only when fit is yes and confidence ≥ floor", () => {
    const proposed = interpretDiscoverFit(
      {
        answers: {
          fit: { kind: "noul", yes: true, probability: 0.9 },
          rules: { kind: "noul", yes: true, probability: 0.8 },
        },
        confidence: 0.85,
      },
      "heuristic",
      0.75,
      {
        name: "fashion",
        title: "Fashion",
        publicDescription: "style",
        subscribers: 10,
        goal: "g",
      }
    );
    assert.equal(proposed.propose, true);
    assert.equal(proposed.wantSamples, false);
    assert.equal(proposed.rulesOk, true);
  });

  it("asks for samples in the mid-confidence band", () => {
    const mid = (DISCOVER_FIT_DROP_BELOW + 0.75) / 2;
    const result = interpretDiscoverFit(
      {
        answers: {
          fit: { kind: "noul", yes: true, probability: mid },
          rules: { kind: "noul", yes: true, probability: mid },
        },
        confidence: mid,
      },
      "heuristic",
      0.75,
      {
        name: "x",
        title: "x",
        publicDescription: "",
        subscribers: 1,
        goal: "g",
      }
    );
    assert.equal(result.propose, false);
    assert.equal(result.wantSamples, true);
  });

  it("never proposes a no-fit even at high confidence", () => {
    const result = interpretDiscoverFit(
      {
        answers: {
          fit: { kind: "noul", yes: false, probability: 0.1 },
          rules: { kind: "noul", yes: true, probability: 0.9 },
        },
        confidence: 0.95,
      },
      "jev",
      0.75,
      {
        name: "spam",
        title: "hauls",
        publicDescription: "",
        subscribers: 1,
        goal: "g",
      }
    );
    assert.equal(result.propose, false);
    assert.equal(result.fitYes, false);
  });
});

describe("scoreDiscoverFit with heuristic port", () => {
  it("proposes a clear fashion-fit sub through DecisionPort", async () => {
    const port = wrapBackend(
      new HeuristicDecisionBackend({ defaultConfidence: 0.9 })
    );
    const result = await scoreDiscoverFit(
      port,
      {
        name: "malefashionadvice",
        title: "MFA",
        publicDescription: "Style advice that fits wardrobe goals",
        subscribers: 50_000,
        goal: "fashion styling help-first communities",
      },
      { minConfidence: 0.7 }
    );
    assert.equal(result.backend, "heuristic");
    assert.equal(result.propose, true);
    assert.equal(result.fitYes, true);
    assert.match(result.evidence, /propose/);
  });

  it("does not auto-promote — propose flag is only for proposed allowlist", async () => {
    const port = wrapBackend(new HeuristicDecisionBackend());
    const result = await scoreDiscoverFit(
      port,
      {
        name: "OUTFITS",
        title: "OUTFITS",
        publicDescription: "Rate my thrift haul spam",
        subscribers: 100,
        goal: "help-first styling",
      },
      { minConfidence: 0.99 }
    );
    // Even if heuristic is noisy, promote-to-postable is never this function's job.
    assert.equal(typeof result.propose, "boolean");
    assert.ok(result.evidence.includes("backend=heuristic"));
  });
});
