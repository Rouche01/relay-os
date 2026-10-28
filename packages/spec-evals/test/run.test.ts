import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SpecV2Body } from "@relay/protocol";
import { createDataEngine } from "@relay/engines-data";
import { lowerSpecV2 } from "@relay/spec-lower";
import {
  assertEvalsGate,
  EvalGateError,
  evalsAllowLive,
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
      {
        id: "helpful_reply",
        kind: "soft",
        judge: {
          rubric: ["threadFit", "soundsHuman", "specificity"],
          minMean: 3.5,
        },
      },
      {
        id: "earns_engagement",
        kind: "outcome",
        metric: { name: "comment_score", after: "48h", min: 2 },
      },
    ],
    steps: [
      {
        id: "draft",
        use: "llm.generate",
        args: { prompt: "Draft a reply" },
        enforce: ["no_promo_links", "allowlist_only"],
      },
      {
        id: "approve",
        use: "human.approve",
        args: { show: "${steps.draft.output}" },
      },
    ],
  };
}

describe("runEvals", () => {
  it("passes good draft + fails bad promo draft (gate)", async () => {
    const spec = engageLiteLike();
    const report = await runEvals({
      spec,
      softFailClosed: false,
      fixtures: {
        cases: [
          {
            id: "good_draft",
            stepId: "draft",
            output: { text: "Try a navy overshirt with raw denim." },
            scope: {
              draft: { text: "Try a navy overshirt with raw denim." },
              item: { subreddit: "malefashionadvice" },
            },
            rules: ["no_promo_links", "allowlist_only"],
          },
          {
            id: "bad_promo",
            description: "Deliberately bad draft with a link must be blocked",
            stepId: "draft",
            output: { text: "Buy now https://spam.example/fit" },
            scope: {
              draft: { text: "Buy now https://spam.example/fit" },
              item: { subreddit: "malefashionadvice" },
            },
            rules: ["no_promo_links"],
            expect: { rules: { no_promo_links: false } },
          },
          {
            id: "bad_sub",
            output: { text: "ok" },
            scope: {
              draft: { text: "ok" },
              item: { subreddit: "wallstreetbets" },
            },
            rules: ["allowlist_only"],
            expect: { rules: { allowlist_only: false } },
          },
        ],
      },
    });

    assert.equal(report.passed, true);
    assert.equal(report.compiled.outcomes.length, 1);
    assert.equal(evalsAllowLive(report), true);
    assert.doesNotThrow(() => assertEvalsGate(report));
  });

  it("refuses live run when a positive case fails", async () => {
    const report = await runEvals({
      spec: engageLiteLike(),
      softFailClosed: false,
      fixtures: {
        cases: [
          {
            id: "should_pass_but_has_link",
            rules: ["no_promo_links"],
            scope: { draft: { text: "see http://x" } },
            expect: { pass: true },
          },
        ],
      },
    });
    assert.equal(report.passed, false);
    assert.throws(() => assertEvalsGate(report), EvalGateError);
  });

  it("dry-run gate runs lowered workflow with auto-HITL", async () => {
    const body: SpecV2Body = {
      goal: "Put and approve",
      budget: { dryRun: true },
      rules: [
        {
          id: "written",
          kind: "hard",
          check: { eq: "${output.written}", value: true },
        },
      ],
      steps: [
        {
          id: "save",
          use: "data.put",
          args: { store: "n", key: "k", value: 1 },
          enforce: ["written"],
        },
        {
          id: "approve",
          use: "human.approve",
          args: { show: "${steps.save.output}" },
        },
        {
          id: "log",
          use: "data.append",
          args: { store: "log", value: "${steps.approve.output}" },
        },
      ],
    };
    const lowered = lowerSpecV2(body);
    const report = await runEvals({
      lowered,
      softFailClosed: false,
      fixtures: {
        cases: [
          {
            id: "put_ok",
            stepId: "save",
            output: { written: true },
            rules: ["written"],
          },
        ],
      },
      dryRun: {
        engines: { data: createDataEngine() },
        softFailClosed: false,
      },
    });

    assert.equal(report.passed, true);
    assert.equal(report.dryRun?.ran, true);
    assert.equal(report.dryRun?.state, "COMPLETE");
    assert.ok((report.dryRun?.evidenceCount ?? 0) > 0);
  });
});
