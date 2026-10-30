import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LlmClient, LlmJsonResult } from "@relay/llm";
import type { SpecV2Body } from "@relay/protocol";
import {
  createFixtureBrowserEngine,
  createFixtureComputerEngine,
  createMemoryRunStateStore,
  resumeSpec,
  runSpec,
} from "../src/index.js";

function stubLlm(): LlmClient {
  return {
    provider: "gemini",
    async completeJson(): Promise<LlmJsonResult> {
      return {
        text: JSON.stringify({ ok: true }),
        provider: "gemini",
        model: "fallback-stub",
      };
    },
  };
}

const browserBody: SpecV2Body = {
  goal: "Open a page, read it, approve, then submit",
  connections: [],
  services: [],
  budget: { maxJobs: 1, dryRun: true },
  rules: [],
  steps: [
    {
      id: "go",
      use: "browser.navigate",
      args: { url: "https://example.com/form" },
    },
    {
      id: "see",
      use: "browser.read",
      args: { as: "text" },
    },
    {
      id: "fill",
      use: "browser.type",
      args: { selector: "#name", text: "Ada" },
    },
    {
      id: "approve",
      use: "human.approve",
      args: { show: "${steps.see.output}", prompt: "Submit form?" },
    },
    {
      id: "send",
      use: "browser.submit",
      args: { selector: "form" },
    },
  ],
};

const computerBody: SpecV2Body = {
  goal: "Observe desktop, approve, then act",
  connections: [],
  services: [],
  budget: { maxJobs: 1, dryRun: true },
  rules: [],
  steps: [
    {
      id: "look",
      use: "computer.observe",
      args: { query: "desktop" },
    },
    {
      id: "approve",
      use: "human.approve",
      args: { show: "${steps.look.output}", prompt: "Click?" },
    },
    {
      id: "click",
      use: "computer.act",
      args: { action: "click", params: { x: 10, y: 20 } },
    },
  ],
};

describe("fixture browser engine", () => {
  it("runs navigate → read → type → HITL → submit with simulated write", async () => {
    const result = await runSpec({
      body: browserBody,
      services: [],
      llmClient: stubLlm(),
      mode: "fixture",
      hitl: { autoApprove: true },
      softFailClosed: true,
      assertRunnable: false,
    });

    assert.equal(result.ok, true);
    assert.equal(result.state, "COMPLETE");
    assert.equal(
      (result.stepOutputs.go as { url?: string })?.url,
      "https://example.com/form"
    );
    assert.ok(
      (result.stepOutputs.send as { dryRunSimulated?: boolean })?.dryRunSimulated
    );
    assert.ok(result.simulatedWriteCount >= 1);
    assert.ok(
      result.evidence.some(
        (e) =>
          e.kind === "execute" &&
          (e.detail as { shadowWrite?: boolean })?.shadowWrite === true
      )
    );
  });

  it("pauses at HITL before browser.submit and resumes", async () => {
    const store = createMemoryRunStateStore();
    const paused = await runSpec({
      body: browserBody,
      services: [],
      llmClient: stubLlm(),
      mode: "fixture",
      hitl: {
        autoApprove: false,
        pauseAndReturn: true,
        runStateStore: store,
        runId: "run_browser_hitl",
      },
      softFailClosed: true,
      assertRunnable: false,
    });
    assert.equal(paused.state, "WAITING_USER");
    assert.equal(paused.checkpoint?.status, "waiting_you");

    const resumed = await resumeSpec({
      runId: "run_browser_hitl",
      runStateStore: store,
      feedback: { action: "proceed", value: true },
      services: [],
      llmClient: stubLlm(),
      hitl: { autoApprove: false, pauseAndReturn: true, runStateStore: store },
      softFailClosed: true,
      assertRunnable: false,
    });
    assert.equal(resumed.state, "COMPLETE");
    assert.ok(
      (resumed.stepOutputs.send as { dryRunSimulated?: boolean })?.dryRunSimulated
    );
  });
});

describe("fixture computer engine", () => {
  it("runs observe → HITL → act with simulated write", async () => {
    const result = await runSpec({
      body: computerBody,
      services: [],
      llmClient: stubLlm(),
      mode: "fixture",
      hitl: { autoApprove: true },
      softFailClosed: true,
      assertRunnable: false,
    });
    assert.equal(result.ok, true);
    assert.ok(
      (result.stepOutputs.look as { image?: string })?.image
    );
    assert.ok(
      (result.stepOutputs.click as { dryRunSimulated?: boolean })?.dryRunSimulated
    );
    assert.ok(result.simulatedWriteCount >= 1);
  });
});

describe("createFixture* engines", () => {
  it("browser logs verbs", async () => {
    const log: { type: string; params: Record<string, unknown> }[] = [];
    const engine = createFixtureBrowserEngine({ dryRun: true, log });
    await engine.execute({
      type: "navigate",
      params: { url: "https://x.test" },
    });
    await engine.execute({
      type: "click",
      params: { selector: "#a" },
    });
    assert.deepEqual(
      log.map((e) => e.type),
      ["navigate", "click"]
    );
  });

  it("computer act fails closed without action", async () => {
    const engine = createFixtureComputerEngine({ dryRun: false });
    const bad = await engine.execute({ type: "act", params: {} });
    assert.equal(bad.success, false);
  });
});
