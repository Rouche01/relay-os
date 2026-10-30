import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AgentRuntimeEvent,
  type EngineAction,
  type EngineResult,
  type ExecutionEngine,
  type SpecV2Body,
} from "@relay/protocol";
import { lowerSpecV2 } from "@relay/spec-lower";
import { getEvidence } from "../src/evidence.js";
import {
  validateAgainstJsonSchema,
  validateDeclaredOutputs,
  validateStepOutput,
} from "../src/output-schema.js";
import { createWorkflowRuntime } from "../src/run.js";

describe("validateAgainstJsonSchema / outputs", () => {
  it("checks required properties and types", () => {
    const schema = {
      type: "object",
      properties: {
        text: { type: "string" },
        issue_number: { type: "number" },
      },
      required: ["text", "issue_number"],
    };
    assert.equal(
      validateAgainstJsonSchema(
        { text: "hi", issue_number: 1 },
        schema
      ).length,
      0
    );
    const missing = validateAgainstJsonSchema({ text: "hi" }, schema);
    assert.ok(missing.some((i) => i.path === "issue_number"));
    const badType = validateAgainstJsonSchema(
      { text: "hi", issue_number: "x" },
      schema
    );
    assert.ok(badType.some((i) => i.path === "issue_number"));
  });

  it("checks declared outputs", () => {
    assert.equal(
      validateDeclaredOutputs({ posts: [] }, ["posts"]).length,
      0
    );
    assert.ok(
      validateDeclaredOutputs({ other: 1 }, ["posts"]).some(
        (i) => i.path === "posts"
      )
    );
  });

  it("validateStepOutput strips llm meta and checks schema", () => {
    const issues = validateStepOutput({
      use: "llm.generate",
      args: {
        schema: {
          type: "object",
          required: ["text"],
          properties: { text: { type: "string" } },
        },
      },
      output: { text: "ok", provider: "stub", model: "x" },
    });
    assert.equal(issues.length, 0);

    const bad = validateStepOutput({
      use: "llm.generate",
      args: {
        schema: {
          type: "object",
          required: ["text"],
          properties: { text: { type: "string" } },
        },
      },
      outputs: ["text", "issue_number"],
      output: { text: "ok", provider: "stub" },
    });
    assert.ok(bad.some((i) => i.path === "issue_number"));
  });
});

describe("runtime output schema fail-closed", () => {
  it("fails the step when llm.generate output misses schema fields", async () => {
    const llm: ExecutionEngine = {
      type: "llm",
      async healthCheck() {
        return true;
      },
      async teardown() {},
      async execute(_action: EngineAction): Promise<EngineResult> {
        return {
          success: true,
          data: { text: "only text", provider: "stub", model: "t" },
        };
      },
    };

    const body: SpecV2Body = {
      goal: "Draft with schema",
      rules: [],
      steps: [
        {
          id: "draft",
          use: "llm.generate",
          args: {
            prompt: "Draft",
            schema: {
              type: "object",
              properties: {
                text: { type: "string" },
                issue_number: { type: "number" },
              },
              required: ["text", "issue_number"],
            },
          },
        },
      ],
    };
    const lowered = lowerSpecV2(body, { name: "schema-fail" });
    const { runtime } = createWorkflowRuntime({
      lowered,
      engines: { llm },
      context: { agentId: "a", userId: "u", sessionId: "s" },
      assertRunnable: false,
    });
    let err: unknown;
    runtime.on(AgentRuntimeEvent.ERROR, (e) => {
      err = e;
    });
    await runtime.start();
    assert.equal(runtime.getState(), "FAILED");
    assert.ok(err instanceof Error);
    const schemaErr = getEvidence(runtime.getContext()).find(
      (e) =>
        e.kind === "error" &&
        String(e.detail.error ?? "").includes("output_schema")
    );
    assert.ok(
      schemaErr,
      `expected schema error evidence, got ${JSON.stringify(getEvidence(runtime.getContext()))}`
    );
  });

  it("passes when schema and outputs match", async () => {
    const llm: ExecutionEngine = {
      type: "llm",
      async healthCheck() {
        return true;
      },
      async teardown() {},
      async execute(): Promise<EngineResult> {
        return {
          success: true,
          data: {
            text: "triage",
            issue_number: 42,
            provider: "stub",
            model: "t",
          },
        };
      },
    };
    const body: SpecV2Body = {
      goal: "Draft ok",
      rules: [],
      steps: [
        {
          id: "draft",
          use: "llm.generate",
          outputs: ["text", "issue_number"],
          args: {
            prompt: "Draft",
            schema: {
              type: "object",
              properties: {
                text: { type: "string" },
                issue_number: { type: "number" },
              },
              required: ["text", "issue_number"],
            },
          },
        },
      ],
    };
    const lowered = lowerSpecV2(body);
    const { runtime } = createWorkflowRuntime({
      lowered,
      engines: { llm },
      context: { agentId: "a", userId: "u", sessionId: "s" },
      assertRunnable: false,
    });
    await runtime.start();
    assert.equal(runtime.getState(), "COMPLETE");
  });
});
