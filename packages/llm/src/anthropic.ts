import type {
  CreateLlmClientOptions,
  LlmClient,
  LlmJsonRequest,
  LlmJsonResult,
  LlmMessage,
} from "./types.js";
import {
  DEFAULT_ANTHROPIC_MODEL,
  messageText,
} from "./types.js";

const TOOL_NAME = "emit_json";

function splitMessages(messages: LlmMessage[]): {
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const systems: string[] = [];
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of messages) {
    const text = messageText(m.content).trim();
    if (!text) continue;
    if (m.role === "system") {
      systems.push(text);
      continue;
    }
    out.push({
      role: m.role === "assistant" ? "assistant" : "user",
      content: text,
    });
  }
  // Anthropic requires messages to start with user; merge consecutive same roles.
  const merged: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of out) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) {
      last.content = `${last.content}\n\n${m.content}`;
    } else {
      merged.push({ ...m });
    }
  }
  if (merged.length === 0) {
    throw new Error("AnthropicLlmClient: no user/assistant content in messages");
  }
  if (merged[0]!.role !== "user") {
    merged.unshift({ role: "user", content: "(continue)" });
  }
  return {
    system: systems.length ? systems.join("\n\n") : undefined,
    messages: merged,
  };
}

function asInputSchema(
  schema: Record<string, unknown>
): Record<string, unknown> {
  // Anthropic tools expect JSON Schema with type object at top level.
  if (schema.type) return schema;
  return { type: "object", ...schema };
}

export class AnthropicLlmClient implements LlmClient {
  readonly provider = "anthropic" as const;
  private readonly apiKey: string;
  private readonly defaultModel: string;

  constructor(opts: { apiKey: string; model?: string }) {
    this.apiKey = opts.apiKey;
    this.defaultModel = opts.model?.trim() || DEFAULT_ANTHROPIC_MODEL;
  }

  async completeJson(req: LlmJsonRequest): Promise<LlmJsonResult> {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: this.apiKey });
    const model = req.model?.trim() || this.defaultModel;
    const { system, messages } = splitMessages(req.messages);

    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      temperature: req.temperature ?? 0.4,
      ...(system ? { system } : {}),
      messages,
      tools: [
        {
          name: TOOL_NAME,
          description:
            "Emit the structured JSON result. Always call this tool with the full object.",
          input_schema: asInputSchema(req.schema) as {
            type: "object";
            properties?: Record<string, unknown>;
            required?: string[];
          },
        },
      ],
      tool_choice: { type: "tool", name: TOOL_NAME },
    });

    const block = response.content.find(
      (b) => b.type === "tool_use" && b.name === TOOL_NAME
    );
    if (!block || block.type !== "tool_use") {
      throw new Error("AnthropicLlmClient: missing forced tool_use in response");
    }
    const text = JSON.stringify(block.input ?? {});
    return { text, provider: "anthropic", model };
  }
}

export function resolveAnthropicApiKey(explicit?: string): string | undefined {
  const key = (explicit ?? process.env.ANTHROPIC_API_KEY ?? "").trim();
  return key || undefined;
}

export function createAnthropicLlmClient(
  opts: CreateLlmClientOptions
): AnthropicLlmClient {
  const apiKey = resolveAnthropicApiKey(opts.apiKey);
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY unset (required for provider=anthropic)"
    );
  }
  return new AnthropicLlmClient({ apiKey, model: opts.model });
}
