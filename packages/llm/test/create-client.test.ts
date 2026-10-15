import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_GEMINI_MODEL,
  parseLlmProviderId,
} from "../src/index.js";
import { jsonSchemaToGemini } from "../src/gemini.js";

describe("parseLlmProviderId", () => {
  it("defaults to gemini", () => {
    assert.equal(parseLlmProviderId(undefined), "gemini");
    assert.equal(parseLlmProviderId(""), "gemini");
  });

  it("accepts aliases", () => {
    assert.equal(parseLlmProviderId("anthropic"), "anthropic");
    assert.equal(parseLlmProviderId("Claude"), "anthropic");
    assert.equal(parseLlmProviderId("google"), "gemini");
  });

  it("rejects unknown providers", () => {
    assert.throws(() => parseLlmProviderId("openai"), /Unknown LLM provider/);
  });
});

describe("defaults", () => {
  it("exports stable default models", () => {
    assert.equal(DEFAULT_GEMINI_MODEL, "gemini-2.5-flash");
    assert.equal(DEFAULT_ANTHROPIC_MODEL, "claude-sonnet-4-5");
  });
});

describe("jsonSchemaToGemini", () => {
  it("maps object/string/integer", () => {
    const Type = {
      OBJECT: "OBJECT",
      STRING: "STRING",
      INTEGER: "INTEGER",
      NUMBER: "NUMBER",
      BOOLEAN: "BOOLEAN",
      ARRAY: "ARRAY",
    };
    const mapped = jsonSchemaToGemini(
      {
        type: "object",
        properties: {
          draftText: { type: "string", description: "comment" },
          intensity: { type: "integer" },
        },
        required: ["draftText", "intensity"],
      },
      Type
    );
    assert.equal(mapped.type, "OBJECT");
    assert.deepEqual(mapped.required, ["draftText", "intensity"]);
    const props = mapped.properties as Record<string, { type: string }>;
    assert.equal(props.draftText.type, "STRING");
    assert.equal(props.intensity.type, "INTEGER");
  });
});
