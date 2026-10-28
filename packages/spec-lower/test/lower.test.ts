import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SpecV2Body } from "@relay/protocol";
import {
  assertLoweredRunnable,
  foreachContextKey,
  hashSpecV2,
  liftLoweredWorkflow,
  lowerSpecV2,
} from "../src/index.js";

function sampleBody(): SpecV2Body {
  return {
    goal: "Help fashion subreddits with useful replies",
    connections: ["reddit:default"],
    services: ["reddit-public", "reddit-oauth"],
    budget: { maxJobs: 3, dryRun: true },
    rules: [
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
    ],
    steps: [
      {
        id: "scout",
        use: "api.request",
        args: {
          service: "reddit-public",
          operation: "listNew",
          params: { subreddit: "malefashionadvice" },
        },
      },
      {
        id: "draft",
        use: "llm.generate",
        forEach: "${steps.scout.output.posts}",
        args: { prompt: "Draft a reply" },
        enforce: ["no_promo_links", "helpful_reply"],
      },
      {
        id: "approve",
        use: "human.approve",
        args: { show: "${steps.draft.output}" },
      },
      {
        id: "post",
        use: "api.request",
        args: {
          service: "reddit-oauth",
          operation: "comment",
          connection: "reddit:default",
          method: "POST",
          params: { thing_id: "t3_x", text: "hi" },
        },
      },
      {
        id: "learn",
        use: "data.append",
        args: { store: "outcomes", value: "${steps.post.output}" },
      },
    ],
  };
}

describe("lowerSpecV2", () => {
  it("maps steps to stages with fanout for forEach and HITL feedback", () => {
    const body = sampleBody();
    const lowered = lowerSpecV2(body, { name: "engager-lite" });

    assert.equal(lowered.kind, "relay.spec.v2");
    assert.equal(lowered.specHash, hashSpecV2(body));
    assert.equal(lowered.manifest.name, "engager-lite");
    assert.equal(lowered.manifest.stages.length, 5);

    const draft = lowered.manifest.stages.find((s) => s.name === "draft");
    assert.ok(draft?.fanout);
    assert.equal(draft!.engine, "none");
    assert.equal(draft!.fanout!.from, foreachContextKey("draft"));
    assert.equal(draft!.fanout!.max, 3);
    assert.equal(draft!.fanout!.manifest.stages[0]?.engine, "llm");
    assert.equal(lowered.relay.foreachFrom.draft, "steps.scout.output.posts");

    const approve = lowered.manifest.stages.find((s) => s.name === "approve");
    assert.equal(approve?.engine, "none");
    assert.equal(approve?.feedback_points?.[0]?.type, "approval");

    const post = lowered.manifest.stages.find((s) => s.name === "post");
    assert.equal(post?.engine, "api");

    assert.ok(lowered.manifest.engines_required.includes("api"));
    assert.ok(lowered.manifest.engines_required.includes("llm"));
    assert.ok(lowered.manifest.engines_required.includes("data"));
    assert.ok(!lowered.manifest.engines_required.includes("none"));
  });

  it("is deterministic for the same Spec body", () => {
    const a = lowerSpecV2(sampleBody());
    const b = lowerSpecV2(sampleBody());
    assert.equal(a.specHash, b.specHash);
    assert.deepEqual(a.manifest.stages.map((s) => s.name), b.manifest.stages.map((s) => s.name));
  });
});

describe("liftLoweredWorkflow", () => {
  it("round-trips and asserts runnable", () => {
    const lowered = lowerSpecV2(sampleBody());
    const lifted = liftLoweredWorkflow(lowered, { validate: false });
    assert.equal(lifted.ok, true);
    assert.equal(lifted.hashMatches, true);
    assert.equal(lifted.spec.steps.length, 5);

    const spec = assertLoweredRunnable(lowered, { validate: false });
    assert.equal(spec.goal, sampleBody().goal);
  });

  it("detects spec_hash drift after Spec edit", () => {
    const lowered = lowerSpecV2(sampleBody());
    lowered.spec.goal = "Changed goal without re-hash";
    const lifted = liftLoweredWorkflow(lowered, { validate: false });
    assert.equal(lifted.ok, false);
    assert.equal(lifted.hashMatches, false);
    assert.ok(lifted.errors.some((e) => e.includes("spec_hash mismatch")));
  });
});
