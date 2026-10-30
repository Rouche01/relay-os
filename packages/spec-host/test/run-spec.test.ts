import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LlmClient, LlmJsonRequest, LlmJsonResult } from "@relay/llm";
import type { ServiceDescriptor, SpecV2Body } from "@relay/protocol";
import {
  createMemoryConnectionStore,
  isSpecHostError,
  runSpec,
  selectServicesForSpec,
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
        { name: "labels", in: "query", type: "string" },
        { name: "state", in: "query", type: "string" },
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

const triageBody: SpecV2Body = {
  goal: "Triage bug issues with HITL before comment",
  connections: ["github:default"],
  services: ["github"],
  budget: { maxJobs: 2, dryRun: true },
  rules: [
    {
      id: "no_promo_links",
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
        params: { owner: "acme", repo: "widgets", labels: "bug", state: "open" },
      },
    },
    {
      id: "draft",
      use: "llm.generate",
      forEach: "${steps.scout.output.body}",
      args: {
        prompt: "Draft a triage comment. Return JSON with text and issue_number.",
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
      enforce: ["no_promo_links"],
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
    async completeJson(req: LlmJsonRequest): Promise<LlmJsonResult> {
      const user = req.messages
        .map((m) => (typeof m.content === "string" ? m.content : ""))
        .join("\n");
      let item: Record<string, unknown> = {};
      const idx = user.lastIndexOf("Input:\n");
      if (idx >= 0) {
        try {
          item = JSON.parse(user.slice(idx + 7)) as Record<string, unknown>;
        } catch {
          item = {};
        }
      }
      return {
        text: JSON.stringify({
          text: `Thanks for reporting "${String(item.title ?? "issue")}". Can you share repro steps?`,
          issue_number: Number(item.number ?? 1),
        }),
        provider: "gemini",
        model: "spec-host-stub",
      };
    },
  };
}

describe("selectServicesForSpec", () => {
  it("returns missing ids", () => {
    const result = selectServicesForSpec(
      { services: ["github", "nope"] },
      [githubLite]
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.deepEqual(result.missing, ["nope"]);
  });

  it("selects catalog entries by Spec.services", () => {
    const result = selectServicesForSpec({ services: ["github"] }, [githubLite]);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.services[0]?.id, "github");
  });
});

describe("runSpec", () => {
  it("runs a Spec with fixtures + stub LLM + autoApprove", async () => {
    const result = await runSpec({
      body: triageBody,
      services: [githubLite],
      connectionStore: createMemoryConnectionStore({
        "github:default": { type: "bearer", token: "test-token" },
      }),
      llmClient: stubLlm(),
      mode: "fixture",
      apiFixtures: [
        {
          service: "github",
          operation: "issuesListForRepo",
          body: [
            {
              number: 42,
              title: "Crash on save",
              state: "open",
              labels: [{ name: "bug" }],
            },
          ],
        },
      ],
      hitl: { autoApprove: true },
      name: "triage-fixture",
      frozenBy: "spec-host-test",
      context: {
        agentId: "test-1",
        userId: "tester",
        sessionId: "sess-1",
      },
      evals: {
        cases: [
          {
            id: "good_draft",
            stepId: "draft",
            output: { text: "Please share repro steps.", issue_number: 42 },
            scope: {
              draft: { text: "Please share repro steps." },
            },
            rules: ["no_promo_links"],
          },
          {
            id: "bad_promo",
            output: { text: "See https://spam.example", issue_number: 1 },
            scope: { draft: { text: "See https://spam.example" } },
            rules: ["no_promo_links"],
            expect: { rules: { no_promo_links: false } },
          },
        ],
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.state, "COMPLETE");
    assert.ok(result.specHash.length > 0);
    assert.ok(result.evidenceCount >= 1);
    assert.ok(Array.isArray(result.stepOutputs.draft));
    assert.equal(result.evalReport?.passed, true);
  });

  it("fails closed on unknown Spec.services", async () => {
    await assert.rejects(
      () =>
        runSpec({
          body: { ...triageBody, services: ["missing-svc"] },
          services: [githubLite],
          connectionStore: createMemoryConnectionStore({
            "github:default": { type: "bearer", token: "t" },
          }),
          llmClient: stubLlm(),
          mode: "fixture",
        }),
      (err: unknown) => {
        assert.ok(isSpecHostError(err));
        if (isSpecHostError(err)) assert.equal(err.code, "missing_services");
        return true;
      }
    );
  });

  it("fails closed when Spec connection is missing from store", async () => {
    await assert.rejects(
      () =>
        runSpec({
          body: triageBody,
          services: [githubLite],
          connectionStore: createMemoryConnectionStore({}),
          llmClient: stubLlm(),
          mode: "fixture",
        }),
      (err: unknown) => {
        assert.ok(isSpecHostError(err));
        if (isSpecHostError(err)) assert.equal(err.code, "missing_connection");
        return true;
      }
    );
  });
});
