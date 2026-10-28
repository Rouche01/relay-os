import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentContext } from "@relay/protocol";
import type { RelayStepsBlock } from "@relay/spec-lower";
import { buildRefScope, lookupRef, resolveRefs } from "../src/index.js";

const relay: RelayStepsBlock = {
  specHash: "x",
  goal: "test goal",
  rules: [],
  steps: [],
  foreachFrom: {},
  budget: { maxJobs: 2, dryRun: true },
};

describe("resolveRefs", () => {
  it("resolves steps.* and shorthand step ids", () => {
    const ctx = {
      agentId: "a",
      userId: "u",
      sessionId: "s",
      steps: {
        scout: { output: { posts: [{ id: "1" }, { id: "2" }] } },
      },
    } as AgentContext;
    const scope = buildRefScope(ctx, relay);

    assert.deepEqual(lookupRef("steps.scout.output.posts", scope), [
      { id: "1" },
      { id: "2" },
    ]);
    assert.deepEqual(lookupRef("scout.posts", scope), [
      { id: "1" },
      { id: "2" },
    ]);
    assert.equal(lookupRef("goal", scope), "test goal");
    assert.equal(lookupRef("budget.maxJobs", scope), 2);

    const args = resolveRefs(
      {
        prompt: "hi",
        list: "${steps.scout.output.posts}",
        nested: { n: "${budget.maxJobs}" },
      },
      scope
    ) as Record<string, unknown>;
    assert.equal(args.prompt, "hi");
    assert.equal((args.list as unknown[]).length, 2);
    assert.equal((args.nested as { n: number }).n, 2);
  });

  it("resolves item in fanout children", () => {
    const ctx = {
      agentId: "a",
      userId: "u",
      sessionId: "s",
      item: { subreddit: "fashion", id: "t3_x" },
      steps: {},
    } as AgentContext;
    const scope = buildRefScope(ctx, relay);
    assert.equal(lookupRef("item.subreddit", scope), "fashion");
  });
});
