import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { LlmClient, LlmJsonResult } from "@relay/llm";
import type { SpecV2Body } from "@relay/protocol";
import {
  approveShadowEvidence,
  assertShadowGate,
  collectSimulatedWrites,
  createMemoryConnectionStore,
  createMemoryRunStateStore,
  enableSpecScheduler,
  isSpecHostError,
  runSpec,
} from "../src/index.js";

function stubLlm(): LlmClient {
  return {
    provider: "gemini",
    async completeJson(): Promise<LlmJsonResult> {
      return {
        text: JSON.stringify({ ok: true }),
        provider: "gemini",
        model: "shadow-stub",
      };
    },
  };
}

const pollBody: SpecV2Body = {
  goal: "Poll then approve",
  connections: [],
  services: [],
  trigger: { poll: { everyMs: 60_000, sourceStep: "look" } },
  budget: { dryRun: true },
  rules: [],
  steps: [
    {
      id: "look",
      use: "computer.observe",
      args: {},
    },
    {
      id: "approve",
      use: "human.approve",
      args: { show: "${steps.look.output}" },
    },
  ],
};

describe("collectSimulatedWrites", () => {
  it("collects step outputs and evidence without duplicating stepId", () => {
    const writes = collectSimulatedWrites(
      {
        post: { dryRunSimulated: true, method: "POST" },
      },
      [
        {
          stepId: "post",
          detail: { shadowWrite: true, method: "POST" },
        },
        {
          stepId: "other",
          detail: { shadowWrite: true },
        },
      ]
    );
    assert.equal(writes.length, 2);
    assert.equal(writes[0]?.source, "stepOutput");
    assert.equal(writes[1]?.stepId, "other");
  });
});

describe("shadow gate", () => {
  it("approves complete shadow runs and gates schedule enable", async () => {
    const store = createMemoryRunStateStore();
    const connections = createMemoryConnectionStore({});
    const result = await runSpec({
      body: pollBody,
      services: [],
      connectionStore: connections,
      llmClient: stubLlm(),
      mode: "shadow",
      blockNetwork: true,
      hitl: {
        autoApprove: true,
        runStateStore: store,
        runId: "run_shadow_1",
      },
      softFailClosed: true,
      assertRunnable: false,
    });
    assert.equal(result.state, "COMPLETE");
    assert.equal(result.mode, "shadow");
    assert.ok(result.specHash);

    try {
      await assertShadowGate({
        store,
        specHash: result.specHash!,
      });
      assert.fail("expected unapproved gate");
    } catch (err) {
      assert.ok(isSpecHostError(err));
      assert.equal(err.code, "shadow_gate_unapproved");
    }

    const dir = mkdtempSync(join(tmpdir(), "relay-shadow-gate-"));
    try {
      try {
        await enableSpecScheduler({
          body: pollBody,
          dataDir: dir,
          invoke: async () => {},
          runStateStore: store,
          logger: { info: () => {}, warn: () => {}, error: () => {} },
        });
        assert.fail("expected enable to fail");
      } catch (err) {
        assert.ok(isSpecHostError(err));
        assert.equal(err.code, "shadow_gate_unapproved");
      }

      const approved = await approveShadowEvidence(store, "run_shadow_1", {
        approvedBy: "operator",
        note: "looks good",
      });
      assert.ok(approved.evidenceApproval?.approvedAt);
      assert.equal(approved.evidenceApproval?.approvedBy, "operator");

      const gated = await assertShadowGate({
        store,
        specHash: result.specHash!,
      });
      assert.equal(gated.runId, "run_shadow_1");

      const enabled = await enableSpecScheduler({
        body: pollBody,
        dataDir: dir,
        invoke: async () => {},
        runStateStore: store,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
      });
      assert.equal(enabled.approvedRun?.runId, "run_shadow_1");
      assert.equal(enabled.specHash, result.specHash);
      enabled.host.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects approving fixture runs", async () => {
    const store = createMemoryRunStateStore();
    await runSpec({
      body: pollBody,
      services: [],
      llmClient: stubLlm(),
      mode: "fixture",
      hitl: {
        autoApprove: true,
        runStateStore: store,
        runId: "run_fixture_1",
      },
      softFailClosed: true,
      assertRunnable: false,
    });
    try {
      await approveShadowEvidence(store, "run_fixture_1");
      assert.fail("expected reject");
    } catch (err) {
      assert.ok(isSpecHostError(err));
      assert.equal(err.code, "shadow_approval_requires_shadow");
    }
  });
});
