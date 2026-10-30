import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { LlmClient, LlmJsonResult } from "@relay/llm";
import type { ServiceDescriptor, SpecV2Body } from "@relay/protocol";
import {
  createFileRunStateStore,
  createMemoryConnectionStore,
  createMemoryRunStateStore,
  listRunSummaries,
  listRuns,
  replaySpecRun,
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
  goal: "Run store list + replay",
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
        model: "store-stub",
      };
    },
  };
}

describe("run store list + replay", () => {
  it("persists terminal runs and lists by specId/specHash", async () => {
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

    const result = await runSpec({
      body,
      services: [githubLite],
      connectionStore: connections,
      llmClient: stubLlm(),
      mode: "fixture",
      apiFixtures: fixtures,
      hitl: {
        autoApprove: true,
        runStateStore: store,
        runId: "run_complete_1",
      },
    });

    assert.equal(result.state, "COMPLETE");
    assert.equal(result.runId, "run_complete_1");
    assert.ok(result.checkpoint);
    assert.equal(result.checkpoint?.status, "complete");
    assert.ok((result.checkpoint?.evidenceCount ?? 0) >= 1);
    assert.ok(result.checkpoint?.stepOutputs);

    const bySpec = await listRunSummaries(store, { specId: result.specId });
    assert.equal(bySpec.length, 1);
    assert.equal(bySpec[0]?.runId, "run_complete_1");
    assert.equal(bySpec[0]?.status, "complete");
    assert.equal(bySpec[0]?.goal, body.goal);

    const byHash = await listRuns(store, { specHash: result.specHash });
    assert.equal(byHash.length, 1);
    assert.equal(byHash[0]?.specHash, result.specHash);
  });

  it("replays a frozen Spec into a new run id", async () => {
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

    await runSpec({
      body,
      services: [githubLite],
      connectionStore: connections,
      llmClient: stubLlm(),
      mode: "fixture",
      apiFixtures: fixtures,
      hitl: {
        autoApprove: true,
        runStateStore: store,
        runId: "run_src",
      },
    });

    const replayed = await replaySpecRun({
      runId: "run_src",
      runStateStore: store,
      services: [githubLite],
      connectionStore: connections,
      llmClient: stubLlm(),
      mode: "fixture",
      apiFixtures: fixtures,
      asRunId: "run_replay",
      hitl: { autoApprove: true, runStateStore: store },
    });

    assert.equal(replayed.state, "COMPLETE");
    assert.equal(replayed.runId, "run_replay");
    const src = await store.get("run_src");
    const copy = await store.get("run_replay");
    assert.equal(src?.status, "complete");
    assert.equal(copy?.status, "complete");
    assert.equal(src?.specHash, copy?.specHash);
    assert.notEqual(src?.runId, copy?.runId);

    const all = await listRunSummaries(store, { specHash: src!.specHash });
    assert.equal(all.length, 2);
  });

  it("FileRunStateStore round-trips list + get", async () => {
    const dir = mkdtempSync(join(tmpdir(), "relay-runs-"));
    try {
      const store = createFileRunStateStore(dir);
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

      const result = await runSpec({
        body,
        services: [githubLite],
        connectionStore: connections,
        llmClient: stubLlm(),
        mode: "fixture",
        apiFixtures: fixtures,
        hitl: {
          autoApprove: true,
          runStateStore: store,
          runId: "run_file_1",
        },
      });

      const reopened = createFileRunStateStore(dir);
      const loaded = await reopened.get("run_file_1");
      assert.ok(loaded);
      assert.equal(loaded.status, "complete");
      assert.equal(loaded.specId, result.specId);
      const summaries = await listRunSummaries(reopened, {
        status: "complete",
      });
      assert.equal(summaries.length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
