import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AgentRuntimeEvent,
  type EngineAction,
  type EngineResult,
  type ExecutionEngine,
  type FeedbackRequest,
  type SpecV2Body,
} from "@relay/protocol";
import { lowerSpecV2 } from "@relay/spec-lower";
import { getEvidence } from "../src/evidence.js";
import { createWorkflowRuntime } from "../src/run.js";

/** Flaky data engine — fails first N executes, then succeeds. */
function flakyEngine(failTimes: number): ExecutionEngine & {
  calls: number;
} {
  let calls = 0;
  const engine: ExecutionEngine & { calls: number } = {
    type: "data",
    get calls() {
      return calls;
    },
    async healthCheck() {
      return true;
    },
    async teardown() {},
    async execute(_action: EngineAction): Promise<EngineResult> {
      calls += 1;
      if (calls <= failTimes) {
        return { success: false, error: `fail_${calls}` };
      }
      return { success: true, data: { ok: true, calls } };
    },
  };
  return engine;
}

describe("Spec v2.1 retry / onError", () => {
  it("retries until success within max attempts", async () => {
    // data.get is not irreversible → retry without once is allowed
    const body: SpecV2Body = {
      goal: "Retry get",
      rules: [],
      steps: [
        {
          id: "read",
          use: "data.get",
          retry: { max: 3, backoffMs: 0 },
          args: { store: "s", key: "k" },
        },
      ],
    };
    const data = flakyEngine(2);
    const lowered = lowerSpecV2(body, { name: "retry-ok" });
    const { runtime } = createWorkflowRuntime({
      lowered,
      engines: { data },
      context: { agentId: "a", userId: "u", sessionId: "s" },
      assertRunnable: false,
    });
    await runtime.start();
    assert.equal(runtime.getState(), "COMPLETE");
    assert.equal(data.calls, 3);
  });

  it("skip_item after exhausted retries", async () => {
    const body: SpecV2Body = {
      goal: "Skip on error",
      rules: [],
      steps: [
        {
          id: "read",
          use: "data.get",
          retry: { max: 2 },
          onError: "skip_item",
          args: { store: "s", key: "k" },
        },
      ],
    };
    const data = flakyEngine(5);
    const lowered = lowerSpecV2(body, { name: "retry-skip" });
    const { runtime } = createWorkflowRuntime({
      lowered,
      engines: { data },
      context: { agentId: "a", userId: "u", sessionId: "s" },
      assertRunnable: false,
    });
    await runtime.start();
    assert.equal(runtime.getState(), "COMPLETE");
    const out = (
      runtime.getContext().steps as Record<
        string,
        { output: { skipped?: boolean; reason?: string } }
      >
    ).read?.output;
    assert.equal(out?.skipped, true);
    assert.equal(out?.reason, "onError");
    const skips = getEvidence(runtime.getContext()).filter(
      (e) => e.kind === "skip"
    );
    assert.ok(skips.length >= 1);
  });

  it("escalate_human pauses then proceed skips", async () => {
    const body: SpecV2Body = {
      goal: "Escalate on error",
      rules: [],
      steps: [
        {
          id: "read",
          use: "data.get",
          retry: { max: 1 },
          onError: "escalate_human",
          args: { store: "s", key: "k" },
        },
      ],
    };
    const data = flakyEngine(5);
    const lowered = lowerSpecV2(body, { name: "retry-esc" });
    assert.ok(
      lowered.manifest.stages[0]?.feedback_points?.some((fp) =>
        fp.description.startsWith("[onError:escalate_human]")
      )
    );
    const { runtime } = createWorkflowRuntime({
      lowered,
      engines: { data },
      context: { agentId: "a", userId: "u", sessionId: "s" },
      assertRunnable: false,
    });

    const startP = runtime.start();
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("no escalate HITL")), 2000);
      runtime.once(
        AgentRuntimeEvent.FEEDBACK_REQUESTED,
        async (req: FeedbackRequest) => {
          clearTimeout(t);
          assert.match(req.prompt, /failed/i);
          await runtime.provideFeedback({
            requestId: req.id,
            agentId: req.agentId,
            action: "proceed",
            value: true,
          });
          resolve();
        }
      );
    });
    await startP;
    assert.equal(runtime.getState(), "COMPLETE");
    const out = (
      runtime.getContext().steps as Record<
        string,
        { output: { skipped?: boolean; onError?: string } }
      >
    ).read?.output;
    assert.equal(out?.skipped, true);
    assert.equal(out?.onError, "escalate_human");
  });
});
