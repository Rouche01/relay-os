import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { LlmClient, LlmJsonResult } from "@relay/llm";
import type { SpecV2Body } from "@relay/protocol";
import {
  createRunSpecInvoker,
  isSpecHostError,
  schedulerHostFromSpec,
} from "../src/index.js";

function stubLlm(): LlmClient {
  return {
    provider: "gemini",
    async completeJson(): Promise<LlmJsonResult> {
      return {
        text: JSON.stringify({ ok: true }),
        provider: "gemini",
        model: "sched-stub",
      };
    },
  };
}

const body: SpecV2Body = {
  goal: "Poll and approve",
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

describe("schedulerHostFromSpec", () => {
  it("arms poll schedule and trigger invokes runSpec", async () => {
    const dir = mkdtempSync(join(tmpdir(), "relay-sched-"));
    let runs = 0;
    try {
      const host = schedulerHostFromSpec({
        body,
        dataDir: dir,
        invoke: async (entrypoint, ctx) => {
          assert.equal(entrypoint, "default");
          assert.equal(ctx.schedule.id, "spec");
          runs += 1;
          const invoker = createRunSpecInvoker({
            body,
            services: [],
            llmClient: stubLlm(),
            mode: "fixture",
            hitl: { autoApprove: true },
            softFailClosed: true,
            assertRunnable: false,
          });
          await invoker(entrypoint, ctx);
        },
        logger: {
          info: () => {},
          warn: () => {},
          error: () => {},
        },
      });

      await host.start();
      await host.trigger("spec");
      assert.equal(runs, 1);
      host.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails closed when Spec has no schedule trigger", () => {
    try {
      schedulerHostFromSpec({
        body: { ...body, trigger: { manual: true } },
        dataDir: "/tmp/unused",
        invoke: async () => {},
      });
      assert.fail("expected throw");
    } catch (err) {
      assert.ok(isSpecHostError(err));
      assert.equal((err as { code: string }).code, "no_spec_schedule");
    }
  });
});
