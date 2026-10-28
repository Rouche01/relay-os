import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LlmClient, LlmJsonRequest, LlmJsonResult } from "@relay/llm";
import { createLlmEngine } from "../src/index.js";

function mockClient(
  handler: (req: LlmJsonRequest) => LlmJsonResult | Promise<LlmJsonResult>
): LlmClient {
  return {
    provider: "gemini",
    completeJson: async (req) => handler(req),
  };
}

describe("LlmEngine", () => {
  it("generate returns text from JSON schema", async () => {
    const engine = createLlmEngine({
      client: mockClient(async () => ({
        text: JSON.stringify({ text: "hello world" }),
        provider: "gemini",
        model: "test",
      })),
    });
    const result = await engine.execute({
      type: "generate",
      params: { prompt: "Say hello" },
    });
    assert.equal(result.success, true);
    assert.equal(result.data.text, "hello world");
  });

  it("classify picks a label from the set", async () => {
    const engine = createLlmEngine({
      client: mockClient(async (req) => {
        assert.ok(JSON.stringify(req.schema).includes("answerable"));
        return {
          text: JSON.stringify({ label: "answerable", confidence: 0.9 }),
          provider: "gemini",
          model: "test",
        };
      }),
    });
    const result = await engine.execute({
      type: "llm.classify",
      params: {
        input: { title: "fit check" },
        labels: ["answerable", "skip"],
      },
    });
    assert.equal(result.success, true);
    assert.equal(result.data.label, "answerable");
  });

  it("extract returns schema fields", async () => {
    const engine = createLlmEngine({
      client: mockClient(async () => ({
        text: JSON.stringify({ thing_id: "t3_1", text: "nice fit" }),
        provider: "anthropic",
        model: "test",
      })),
    });
    const result = await engine.execute({
      type: "extract",
      params: {
        input: "post about shoes",
        schema: {
          type: "object",
          properties: {
            thing_id: { type: "string" },
            text: { type: "string" },
          },
          required: ["thing_id", "text"],
        },
      },
    });
    assert.equal(result.success, true);
    assert.equal(result.data.thing_id, "t3_1");
  });

  it("judge scores rubric and applies minMean", async () => {
    const engine = createLlmEngine({
      client: mockClient(async () => ({
        text: JSON.stringify({
          threadFit: 4,
          soundsHuman: 5,
          specificity: 3,
          rationale: "ok",
        }),
        provider: "gemini",
        model: "test",
      })),
    });
    const result = await engine.execute({
      type: "judge",
      params: {
        input: { draft: "…" },
        rubric: ["threadFit", "soundsHuman", "specificity"],
        minMean: 3.5,
      },
    });
    assert.equal(result.success, true);
    assert.equal(result.data.mean, 4);
    assert.equal(result.data.passed, true);
  });

  it("fails closed on missing prompt / bad label", async () => {
    const engine = createLlmEngine({
      client: mockClient(async () => ({
        text: JSON.stringify({ label: "nope" }),
        provider: "gemini",
        model: "test",
      })),
    });
    const missing = await engine.execute({
      type: "generate",
      params: {},
    });
    assert.equal(missing.success, false);

    const bad = await engine.execute({
      type: "classify",
      params: { input: "x", labels: ["a", "b"] },
    });
    assert.equal(bad.success, false);
  });
});
