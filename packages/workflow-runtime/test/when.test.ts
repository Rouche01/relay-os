import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDataEngine } from "@relay/engines-data";
import type { SpecV2Body } from "@relay/protocol";
import { lowerSpecV2 } from "@relay/spec-lower";
import { getEvidence } from "../src/evidence.js";
import { createWorkflowRuntime } from "../src/run.js";
import { evaluateWhen } from "../src/when.js";

describe("evaluateWhen", () => {
  it("supports ref / eq / ne / in / exists", () => {
    const scope = {
      item: { label: "bug", id: 1 },
      steps: {},
    };
    assert.equal(evaluateWhen("${item.label}", scope).ok, true);
    assert.equal(
      evaluateWhen({ eq: "${item.label}", value: "bug" }, scope).ok,
      true
    );
    assert.equal(
      evaluateWhen({ ne: "${item.label}", value: "feature" }, scope).ok,
      true
    );
    assert.equal(
      evaluateWhen({ in: "${item.label}", list: ["bug", "chore"] }, scope).ok,
      true
    );
    assert.equal(evaluateWhen({ exists: "${item.id}" }, scope).ok, true);
    assert.equal(
      evaluateWhen({ eq: "${item.label}", value: "other" }, scope).ok,
      false
    );
    assert.equal(
      evaluateWhen({ exists: "${item.missing}" }, scope).ok,
      false
    );
  });
});

describe("Spec v2.1 when runtime", () => {
  it("skips fanout children when when is false", async () => {
    const body: SpecV2Body = {
      goal: "Conditional puts",
      budget: { maxJobs: 5, dryRun: true },
      rules: [],
      steps: [
        {
          id: "seed",
          use: "data.put",
          args: {
            store: "items",
            key: "list",
            value: [
              { id: "keep", ok: true },
              { id: "drop", ok: false },
            ],
          },
        },
        {
          id: "read",
          use: "data.get",
          args: { store: "items", key: "list" },
        },
        {
          id: "write_each",
          use: "data.put",
          forEach: "${steps.read.output.value}",
          when: { eq: "${item.ok}", value: true },
          args: {
            store: "out",
            key: "${item.id}",
            value: "${item.id}",
          },
        },
      ],
    };
    const lowered = lowerSpecV2(body, { name: "when-wf" });
    const data = createDataEngine();
    const { runtime } = createWorkflowRuntime({
      lowered,
      engines: { data },
      context: { agentId: "a", userId: "u", sessionId: "s" },
      assertRunnable: false,
    });
    await runtime.start();
    assert.equal(runtime.getState(), "COMPLETE");

    const skips = getEvidence(runtime.getContext()).filter(
      (e) => e.kind === "skip" && e.detail.reason === "when"
    );
    assert.ok(skips.length >= 1);

    const keep = await data.execute({
      type: "get",
      params: { store: "out", key: "keep" },
    });
    assert.equal((keep.data as { value?: unknown }).value, "keep");

    const drop = await data.execute({
      type: "get",
      params: { store: "out", key: "drop" },
    });
    assert.equal((drop.data as { value?: unknown }).value, undefined);
  });
});
