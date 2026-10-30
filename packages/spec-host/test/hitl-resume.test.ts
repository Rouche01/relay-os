import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LlmClient, LlmJsonResult } from "@relay/llm";
import type { ServiceDescriptor, SpecV2Body } from "@relay/protocol";
import {
  createMemoryConnectionStore,
  createMemoryRunStateStore,
  resumeSpec,
  runSpec,
} from "../src/index.js";

const githubLite: ServiceDescriptor = {
  id: "github",
  baseUrl: "https://api.github.com",
  auth: { type: "bearer", connection: true },
  operations: [
    {
      id: "issuesListForRepo",
      method: "GET",
      path: "/repos/{owner}/{repo}/issues",
      params: [
        { name: "owner", in: "path", required: true, type: "string" },
        { name: "repo", in: "path", required: true, type: "string" },
      ],
    },
    {
      id: "issuesCreateComment",
      method: "POST",
      path: "/repos/{owner}/{repo}/issues/{issue_number}/comments",
      params: [
        { name: "owner", in: "path", required: true, type: "string" },
        { name: "repo", in: "path", required: true, type: "string" },
        { name: "issue_number", in: "path", required: true, type: "number" },
        { name: "body", in: "body", required: true, type: "string" },
      ],
    },
  ],
};

const body: SpecV2Body = {
  goal: "HITL pause resume",
  connections: ["github:default"],
  services: ["github"],
  budget: { maxJobs: 1, dryRun: true },
  rules: [
    {
      id: "no_links",
      kind: "hard",
      check: { notMatches: "${draft.text}", pattern: "https?://" },
    },
  ],
  steps: [
    {
      id: "scout",
      use: "api.request",
      args: {
        service: "github",
        operation: "issuesListForRepo",
        connection: "github:default",
        params: { owner: "acme", repo: "widgets" },
      },
    },
    {
      id: "draft",
      use: "llm.generate",
      forEach: "${steps.scout.output.body}",
      args: {
        prompt: "Draft",
        input: "${item}",
        schema: {
          type: "object",
          properties: {
            text: { type: "string" },
            issue_number: { type: "number" },
          },
          required: ["text", "issue_number"],
        },
      },
      enforce: ["no_links"],
    },
    {
      id: "approve",
      use: "human.approve",
      args: { show: "${steps.draft.output}", prompt: "Approve?" },
    },
    {
      id: "post",
      use: "api.request",
      forEach: "${steps.draft.output}",
      args: {
        service: "github",
        operation: "issuesCreateComment",
        connection: "github:default",
        method: "POST",
        params: {
          owner: "acme",
          repo: "widgets",
          issue_number: "${item.issue_number}",
          body: "${item.text}",
        },
      },
    },
  ],
};

function stubLlm(): LlmClient {
  return {
    provider: "gemini",
    async completeJson(): Promise<LlmJsonResult> {
      return {
        text: JSON.stringify({
          text: "Please share repro steps.",
          issue_number: 9,
        }),
        provider: "gemini",
        model: "hitl-stub",
      };
    },
  };
}

describe("HITL pause + resume", () => {
  it("pauses at human.approve, persists checkpoint, resumes after restart", async () => {
    const store = createMemoryRunStateStore();
    const connections = createMemoryConnectionStore({
      "github:default": { type: "bearer", token: "t" },
    });
    const fixtures = [
      {
        service: "github",
        operation: "issuesListForRepo",
        body: [{ number: 9, title: "Bug" }],
      },
    ];

    const paused = await runSpec({
      body,
      services: [githubLite],
      connectionStore: connections,
      llmClient: stubLlm(),
      mode: "fixture",
      apiFixtures: fixtures,
      hitl: {
        autoApprove: false,
        pauseAndReturn: true,
        runStateStore: store,
        runId: "run_hitl_1",
      },
    });

    assert.equal(paused.state, "WAITING_USER");
    assert.equal(paused.ok, false);
    assert.ok(paused.checkpoint);
    assert.equal(paused.checkpoint?.status, "waiting_you");
    assert.ok(paused.pendingFeedback);
    assert.equal(paused.runId, "run_hitl_1");

    // Simulate process restart: drop runtime, load from store only.
    const resumed = await resumeSpec({
      runId: "run_hitl_1",
      runStateStore: store,
      feedback: { action: "proceed", value: true },
      services: [githubLite],
      connectionStore: connections,
      llmClient: stubLlm(),
      apiFixtures: fixtures,
      hitl: { autoApprove: false, pauseAndReturn: true, runStateStore: store },
    });

    assert.equal(resumed.state, "COMPLETE");
    assert.equal(resumed.ok, true);
    assert.ok(resumed.simulatedWriteCount >= 1);
    const saved = await store.get("run_hitl_1");
    assert.equal(saved?.status, "complete");
  });

  it("abort via resume leaves ABORTED", async () => {
    const store = createMemoryRunStateStore();
    const connections = createMemoryConnectionStore({
      "github:default": { type: "bearer", token: "t" },
    });
    const fixtures = [
      {
        service: "github",
        operation: "issuesListForRepo",
        body: [{ number: 1, title: "x" }],
      },
    ];

    await runSpec({
      body,
      services: [githubLite],
      connectionStore: connections,
      llmClient: stubLlm(),
      mode: "fixture",
      apiFixtures: fixtures,
      hitl: {
        autoApprove: false,
        pauseAndReturn: true,
        runStateStore: store,
        runId: "run_abort",
      },
    });

    const resumed = await resumeSpec({
      runId: "run_abort",
      runStateStore: store,
      feedback: { action: "abort", value: "nope" },
      services: [githubLite],
      connectionStore: connections,
      llmClient: stubLlm(),
      apiFixtures: fixtures,
    });

    assert.equal(resumed.state, "ABORTED");
    assert.equal(resumed.ok, false);
  });
});
