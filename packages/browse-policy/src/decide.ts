import type { LlmClient } from "@relay/llm";
import {
  buildBrowseSystemPrompt,
  buildBrowseUserPrompt,
} from "./prompt.js";
import type {
  BrowseDecideInput,
  BrowseDecider,
  BrowseDecision,
  BrowseDecisionKind,
} from "./types.js";

const DECISION_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["kind"],
  properties: {
    kind: {
      type: "string",
      enum: ["act", "done", "need_human"],
    },
    reason: { type: "string" },
    action: {
      type: "object",
      additionalProperties: false,
      required: ["type"],
      properties: {
        type: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        x1: { type: "number" },
        y1: { type: "number" },
        x2: { type: "number" },
        y2: { type: "number" },
        text: { type: "string" },
        direction: { type: "string" },
        amount: { type: "number" },
        duration_ms: { type: "number" },
        package: { type: "string" },
        uri: { type: "string" },
        ref: { type: "string" },
      },
    },
  },
};

function parseDecision(raw: string): BrowseDecision {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`BrowseDecider: LLM returned non-JSON: ${raw.slice(0, 200)}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("BrowseDecider: decision must be an object");
  }
  const obj = parsed as Record<string, unknown>;
  const kind = obj.kind as BrowseDecisionKind;
  if (kind !== "act" && kind !== "done" && kind !== "need_human") {
    throw new Error(`BrowseDecider: invalid kind ${String(obj.kind)}`);
  }

  if (kind === "act") {
    const action = obj.action;
    if (!action || typeof action !== "object") {
      throw new Error('BrowseDecider: kind "act" requires action');
    }
    const a = action as Record<string, unknown>;
    if (typeof a.type !== "string" || !a.type.trim()) {
      throw new Error('BrowseDecider: action.type is required');
    }
    return {
      kind,
      reason: typeof obj.reason === "string" ? obj.reason : undefined,
      action: {
        type: a.type,
        ...(typeof a.x === "number" ? { x: a.x } : {}),
        ...(typeof a.y === "number" ? { y: a.y } : {}),
        ...(typeof a.x1 === "number" ? { x1: a.x1 } : {}),
        ...(typeof a.y1 === "number" ? { y1: a.y1 } : {}),
        ...(typeof a.x2 === "number" ? { x2: a.x2 } : {}),
        ...(typeof a.y2 === "number" ? { y2: a.y2 } : {}),
        ...(typeof a.text === "string" ? { text: a.text } : {}),
        ...(typeof a.direction === "string" ? { direction: a.direction } : {}),
        ...(typeof a.amount === "number" ? { amount: a.amount } : {}),
        ...(typeof a.duration_ms === "number" ? { duration_ms: a.duration_ms } : {}),
        ...(typeof a.package === "string" ? { package: a.package } : {}),
        ...(typeof a.uri === "string" ? { uri: a.uri } : {}),
        ...(typeof a.ref === "string" ? { ref: a.ref } : {}),
      },
    };
  }

  return {
    kind,
    reason: typeof obj.reason === "string" ? obj.reason : undefined,
  };
}

export function createLlmBrowseDecider(client: LlmClient): BrowseDecider {
  return {
    async decide(input: BrowseDecideInput): Promise<BrowseDecision> {
      const imageUrl = input.observation.imageBase64.startsWith("data:")
        ? input.observation.imageBase64
        : `data:image/png;base64,${input.observation.imageBase64}`;

      const result = await client.completeJson({
        schema: DECISION_SCHEMA,
        temperature: 0.2,
        messages: [
          { role: "system", content: buildBrowseSystemPrompt(input.goal) },
          {
            role: "user",
            content: [
              { type: "text", text: buildBrowseUserPrompt(input) },
              { type: "image_url", url: imageUrl },
            ],
          },
        ],
      });

      return parseDecision(result.text);
    },
  };
}

/** Test helper: fixed sequence of decisions. */
export function createScriptedDecider(
  decisions: BrowseDecision[]
): BrowseDecider {
  let i = 0;
  return {
    async decide(): Promise<BrowseDecision> {
      if (i >= decisions.length) {
        return { kind: "done", reason: "script exhausted" };
      }
      return decisions[i++]!;
    },
  };
}
