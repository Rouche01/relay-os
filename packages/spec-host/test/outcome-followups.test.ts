import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LlmClient, LlmJsonResult } from "@relay/llm";
import {
  outcomeScheduleId,
  parseDurationMs,
  type SpecV2Body,
} from "@relay/protocol";
import {
  createMemoryRunStateStore,
  isSpecHostError,
  listDueOutcomeFollowUps,
  processDueOutcomeFollowUps,
  recordOutcomeFollowUp,
  runSpec,
} from "../src/index.js";

function stubLlm(): LlmClient {
  return {
    provider: "gemini",
    async completeJson(): Promise<LlmJsonResult> {
      return {
        text: JSON.stringify({ ok: true }),
        provider: "gemini",
        model: "outcome-stub",
      };
    },
  };
}

const body: SpecV2Body = {
  goal: "Measure engagement later",
  connections: [],
  services: [],
  budget: { dryRun: true },
  rules: [
    {
      id: "got_reply",
      kind: "outcome",
      metric: { name: "replies", after: "1h", min: 1 },
    },
  ],
  steps: [
    {
      id: "approve",
      use: "human.approve",
      args: { show: "ready" },
    },
  ],
};

describe("parseDurationMs", () => {
  it("parses common units", () => {
    assert.equal(parseDurationMs("48h"), 48 * 3_600_000);
    assert.equal(parseDurationMs("72H"), 72 * 3_600_000);
    assert.equal(parseDurationMs("7d"), 7 * 86_400_000);
    assert.equal(parseDurationMs("30m"), 30 * 60_000);
    assert.equal(parseDurationMs("90s"), 90_000);
    assert.equal(parseDurationMs("500ms"), 500);
    assert.equal(parseDurationMs("1000"), 1000);
  });
});

describe("outcome follow-ups", () => {
  it("enqueues on complete and records when due", async () => {
    const store = createMemoryRunStateStore();
    const result = await runSpec({
      body,
      services: [],
      llmClient: stubLlm(),
      mode: "fixture",
      hitl: {
        autoApprove: true,
        runStateStore: store,
        runId: "run_outcome_1",
      },
      softFailClosed: true,
      assertRunnable: false,
    });
    assert.equal(result.state, "COMPLETE");
    const cp = result.checkpoint!;
    assert.equal(cp.outcomeFollowUps?.length, 1);
    assert.equal(cp.outcomeFollowUps?.[0]?.ruleId, "got_reply");
    assert.equal(cp.outcomeFollowUps?.[0]?.status, "pending");
    assert.equal(cp.outcomeFollowUps?.[0]?.afterMs, 3_600_000);

    const notYet = await listDueOutcomeFollowUps(store, {
      now: new Date(Date.now() - 60_000).toISOString(),
    });
    assert.equal(notYet.length, 0);

    const dueAt = cp.outcomeFollowUps![0]!.dueAt;
    const due = await listDueOutcomeFollowUps(store, { now: dueAt });
    assert.equal(due.length, 1);

    const processed = await processDueOutcomeFollowUps(store, {
      entrypointOrRuleId: outcomeScheduleId("got_reply"),
      now: dueAt,
      measure: async () => ({ value: 2, detail: { source: "test" } }),
    });
    assert.equal(processed.processed, 1);

    const after = await store.get("run_outcome_1");
    assert.equal(after?.outcomeFollowUps?.[0]?.status, "complete");
    assert.equal(after?.outcomeFollowUps?.[0]?.result?.value, 2);
    assert.equal(after?.outcomeFollowUps?.[0]?.result?.passed, true);
  });

  it("fails closed when follow-up missing", async () => {
    const store = createMemoryRunStateStore();
    await runSpec({
      body: { ...body, rules: [] },
      services: [],
      llmClient: stubLlm(),
      mode: "fixture",
      hitl: {
        autoApprove: true,
        runStateStore: store,
        runId: "run_no_outcome",
      },
      softFailClosed: true,
      assertRunnable: false,
    });
    try {
      await recordOutcomeFollowUp(store, {
        parentRunId: "run_no_outcome",
        ruleId: "missing",
      });
      assert.fail("expected throw");
    } catch (err) {
      assert.ok(isSpecHostError(err));
      assert.equal(err.code, "outcome_followup_missing");
    }
  });
});
