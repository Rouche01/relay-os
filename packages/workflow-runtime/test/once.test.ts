import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDataEngine, MemoryDataStore } from "@relay/engines-data";
import type { SpecV2Body } from "@relay/protocol";
import { lowerSpecV2 } from "@relay/spec-lower";
import { getEvidence } from "../src/evidence.js";
import { RELAY_ONCE_STORE } from "../src/once.js";
import { createWorkflowRuntime } from "../src/run.js";

function onceBody(): SpecV2Body {
  return {
    goal: "Put each item once",
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
            { id: "a", text: "one" },
            { id: "b", text: "two" },
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
        once: "${item.id}",
        args: {
          store: "out",
          key: "${item.id}",
          value: "${item.text}",
        },
      },
    ],
  };
}

describe("Spec v2.1 once", () => {
  it("commits once keys and skips duplicates on second run", async () => {
    const store = new MemoryDataStore();
    const body = onceBody();
    const lowered = lowerSpecV2(body, { name: "once-wf" });

    const first = createWorkflowRuntime({
      lowered,
      engines: { data: createDataEngine({ store }) },
      context: { agentId: "a", userId: "u", sessionId: "s1" },
      assertRunnable: false,
    });
    await first.runtime.start();
    assert.equal(first.runtime.getState(), "COMPLETE");

    const committed = await store.query(RELAY_ONCE_STORE);
    assert.ok(committed.length >= 2, `expected ≥2 once keys, got ${committed.length}`);

    const second = createWorkflowRuntime({
      lowered,
      engines: { data: createDataEngine({ store }) },
      context: { agentId: "a", userId: "u", sessionId: "s2" },
      assertRunnable: false,
    });
    await second.runtime.start();
    assert.equal(second.runtime.getState(), "COMPLETE");

    const evidence = getEvidence(second.runtime.getContext());
    const skips = evidence.filter(
      (e) =>
        e.kind === "skip" &&
        e.detail.reason === "once" &&
        e.stepId === "write_each"
    );
    const onceKeys = new Set(
      skips.map((e) => String(e.detail.onceKey ?? ""))
    );
    assert.ok(onceKeys.has("a"), JSON.stringify([...onceKeys]));
    assert.ok(onceKeys.has("b"), JSON.stringify([...onceKeys]));
    assert.ok(skips.length >= 2);

    const outs = (
      second.runtime.getContext().steps as Record<
        string,
        { output: unknown }
      >
    ).write_each?.output;
    assert.ok(Array.isArray(outs));
    const skippedRows = (outs as Array<{ skipped?: boolean }>).filter(
      (r) => r?.skipped === true
    );
    assert.ok(skippedRows.length >= 2);
  });
});
