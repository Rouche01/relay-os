import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LlmClient, LlmJsonResult } from "@relay/llm";
import type { ServiceDescriptor, SpecV2Body } from "@relay/protocol";
import {
  assertModeAllowed,
  countSimulatedWrites,
  createMemoryConnectionStore,
  isSpecHostError,
  resolveHostDefaults,
  runSpec,
} from "../src/index.js";

describe("resolveHostDefaults", () => {
  it("fixture blocks network and dry-runs by default", () => {
    assert.deepEqual(resolveHostDefaults({ mode: "fixture" }), {
      mode: "fixture",
      dryRun: true,
      blockNetwork: true,
    });
  });

  it("shadow always dryRuns and allows network", () => {
    assert.deepEqual(
      resolveHostDefaults({ mode: "shadow", dryRun: false }),
      {
        mode: "shadow",
        dryRun: true,
        blockNetwork: false,
      }
    );
  });

  it("live opens writes only when budget.dryRun is false", () => {
    assert.equal(
      resolveHostDefaults({ mode: "live", budgetDryRun: false }).dryRun,
      false
    );
    assert.equal(
      resolveHostDefaults({ mode: "live", budgetDryRun: true }).dryRun,
      true
    );
  });
});

describe("assertModeAllowed", () => {
  it("rejects live when Spec still dryRun", () => {
    assert.throws(
      () =>
        assertModeAllowed(
          "live",
          { budget: { dryRun: true } },
          { dryRun: true, blockNetwork: false }
        ),
      (err: unknown) =>
        isSpecHostError(err) && err.code === "live_requires_budget"
    );
  });
});

describe("countSimulatedWrites", () => {
  it("counts nested dryRunSimulated", () => {
    assert.equal(
      countSimulatedWrites({
        post: [
          { dryRunSimulated: true, body: { dryRun: true } },
          { dryRunSimulated: true },
        ],
      }),
      2
    );
  });
});

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

function stubLlm(): LlmClient {
  return {
    provider: "gemini",
    async completeJson(): Promise<LlmJsonResult> {
      return {
        text: JSON.stringify({
          text: "Thanks — please share repro steps.",
          issue_number: 7,
        }),
        provider: "gemini",
        model: "mode-stub",
      };
    },
  };
}

const shadowBody: SpecV2Body = {
  goal: "Shadow triage",
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
      args: { show: "${steps.draft.output}" },
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

describe("shadow mode", () => {
  it("live GETs via fetch; POSTs simulated; evidence marks shadowWrite", async () => {
    const methods: string[] = [];
    const fetchMock = (async (
      _input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const method = (init?.method ?? "GET").toUpperCase();
      methods.push(method);
      assert.notEqual(method, "POST");
      return new Response(
        JSON.stringify([{ number: 7, title: "Bug" }]),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }) as typeof fetch;

    const result = await runSpec({
      body: shadowBody,
      services: [githubLite],
      mode: "shadow",
      connectionStore: createMemoryConnectionStore({
        "github:default": { type: "bearer", token: "shadow-token" },
      }),
      llmClient: stubLlm(),
      fetch: fetchMock,
      hitl: { autoApprove: true },
      name: "shadow-test",
    });

    assert.equal(result.ok, true);
    assert.equal(result.mode, "shadow");
    assert.equal(result.dryRun, true);
    assert.equal(result.blockNetwork, false);
    assert.ok(methods.includes("GET"));
    assert.ok(!methods.includes("POST"));
    assert.ok(result.simulatedWriteCount >= 1);
    assert.ok(
      result.evidence.some(
        (e) => e.kind === "execute" && e.detail.shadowWrite === true
      )
    );
  });

  it("rejects live without budget.dryRun false", async () => {
    await assert.rejects(
      () =>
        runSpec({
          body: shadowBody,
          services: [githubLite],
          mode: "live",
          connectionStore: createMemoryConnectionStore({
            "github:default": { type: "bearer", token: "t" },
          }),
          llmClient: stubLlm(),
          hitl: { autoApprove: true },
        }),
      (err: unknown) =>
        isSpecHostError(err) && err.code === "live_requires_budget"
    );
  });
});
