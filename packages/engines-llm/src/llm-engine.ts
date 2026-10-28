import type { LlmClient, LlmMessage } from "@relay/llm";
import type {
  EngineAction,
  EngineResult,
  ExecutionEngine,
} from "@relay/protocol";

export type LlmEngineOptions = {
  client: LlmClient;
  /** Default temperature for generate (default 0.4). */
  temperature?: number;
};

const TEXT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    text: { type: "string", description: "Generated text" },
  },
  required: ["text"],
};

function classifySchema(labels: string[]): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      label: {
        type: "string",
        enum: labels,
        description: "Chosen class label",
      },
      confidence: {
        type: "number",
        description: "Optional 0–1 confidence",
      },
      rationale: { type: "string" },
    },
    required: ["label"],
  };
}

function judgeSchema(rubric: string[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const dim of rubric) {
    properties[dim] = {
      type: "integer",
      description: `Score 1–5 for ${dim}`,
    };
  }
  properties.rationale = { type: "string" };
  return {
    type: "object",
    properties,
    required: [...rubric],
  };
}

function asMessages(
  prompt: string,
  system?: string,
  input?: unknown
): LlmMessage[] {
  const messages: LlmMessage[] = [];
  if (system?.trim()) {
    messages.push({ role: "system", content: system.trim() });
  }
  let user = prompt;
  if (input !== undefined) {
    const serialized =
      typeof input === "string" ? input : JSON.stringify(input, null, 2);
    user = `${prompt}\n\nInput:\n${serialized}`;
  }
  messages.push({ role: "user", content: user });
  return messages;
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`LLM returned non-JSON: ${text.slice(0, 200)}`);
  }
}

function clampScore(n: unknown): number | null {
  const v = typeof n === "number" ? n : typeof n === "string" ? Number(n) : NaN;
  if (!Number.isFinite(v)) return null;
  return Math.max(1, Math.min(5, Math.round(v)));
}

/**
 * Spec v2 llm.* capabilities over {@link LlmClient.completeJson}.
 *
 * Action types: `generate` | `classify` | `extract` | `judge`
 * (also accepts `llm.generate` etc.).
 */
export class LlmEngine implements ExecutionEngine {
  public readonly type = "llm" as const;

  private readonly client: LlmClient;
  private readonly temperature: number;

  constructor(options: LlmEngineOptions) {
    if (!options.client) {
      throw new Error("LlmEngine requires an LlmClient");
    }
    this.client = options.client;
    this.temperature = options.temperature ?? 0.4;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async teardown(): Promise<void> {}

  async execute(action: EngineAction): Promise<EngineResult> {
    const verb = normalizeVerb(action.type);
    try {
      switch (verb) {
        case "generate":
          return { success: true, data: await this.generate(action.params) };
        case "classify":
          return { success: true, data: await this.classify(action.params) };
        case "extract":
          return { success: true, data: await this.extract(action.params) };
        case "judge":
          return { success: true, data: await this.judge(action.params) };
        default:
          return {
            success: false,
            error: `Unsupported llm action: ${action.type}`,
          };
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async generate(params: Record<string, unknown>): Promise<unknown> {
    const prompt = String(params.prompt ?? "").trim();
    if (!prompt) throw new Error("llm.generate requires prompt");
    const system =
      typeof params.system === "string" ? params.system : undefined;
    const schema =
      params.schema && typeof params.schema === "object"
        ? (params.schema as Record<string, unknown>)
        : TEXT_SCHEMA;

    const result = await this.client.completeJson({
      messages: asMessages(prompt, system, params.input),
      schema,
      temperature: this.temperature,
    });
    const parsed = parseJsonObject(result.text);
    if (schema === TEXT_SCHEMA) {
      return {
        text: String(parsed.text ?? ""),
        provider: result.provider,
        model: result.model,
      };
    }
    return { ...parsed, provider: result.provider, model: result.model };
  }

  private async classify(params: Record<string, unknown>): Promise<unknown> {
    if (params.input === undefined) {
      throw new Error("llm.classify requires input");
    }
    const labels = Array.isArray(params.labels)
      ? params.labels.map((l) => String(l))
      : [];
    if (labels.length === 0) {
      throw new Error("llm.classify requires non-empty labels");
    }
    const prompt =
      typeof params.prompt === "string" && params.prompt.trim()
        ? params.prompt.trim()
        : `Classify the input into exactly one of: ${labels.join(", ")}.`;

    const result = await this.client.completeJson({
      messages: asMessages(prompt, undefined, params.input),
      schema: classifySchema(labels),
      temperature: 0.1,
    });
    const parsed = parseJsonObject(result.text);
    const label = String(parsed.label ?? "");
    if (!labels.includes(label)) {
      throw new Error(
        `llm.classify returned label ${JSON.stringify(label)} not in ${JSON.stringify(labels)}`
      );
    }
    return {
      label,
      confidence: parsed.confidence,
      rationale: parsed.rationale,
      provider: result.provider,
      model: result.model,
    };
  }

  private async extract(params: Record<string, unknown>): Promise<unknown> {
    if (params.input === undefined) {
      throw new Error("llm.extract requires input");
    }
    if (!params.schema || typeof params.schema !== "object") {
      throw new Error("llm.extract requires schema");
    }
    const prompt =
      typeof params.prompt === "string" && params.prompt.trim()
        ? params.prompt.trim()
        : "Extract fields from the input matching the JSON schema.";

    const result = await this.client.completeJson({
      messages: asMessages(prompt, undefined, params.input),
      schema: params.schema as Record<string, unknown>,
      temperature: 0.1,
    });
    const parsed = parseJsonObject(result.text);
    return { ...parsed, provider: result.provider, model: result.model };
  }

  private async judge(params: Record<string, unknown>): Promise<unknown> {
    if (params.input === undefined) {
      throw new Error("llm.judge requires input");
    }
    const rubric = Array.isArray(params.rubric)
      ? params.rubric.map((r) => String(r))
      : [];
    if (rubric.length === 0) {
      throw new Error("llm.judge requires non-empty rubric");
    }
    const minMean =
      typeof params.minMean === "number" ? params.minMean : undefined;

    const prompt =
      typeof params.prompt === "string" && params.prompt.trim()
        ? params.prompt.trim()
        : `Score the input on each rubric dimension from 1–5. Be strict. Dimensions: ${rubric.join(", ")}.`;

    const result = await this.client.completeJson({
      messages: asMessages(prompt, undefined, params.input),
      schema: judgeSchema(rubric),
      temperature: 0.2,
    });
    const parsed = parseJsonObject(result.text);
    const scores: Record<string, number> = {};
    for (const dim of rubric) {
      const s = clampScore(parsed[dim]);
      if (s === null) {
        throw new Error(`llm.judge missing score for ${JSON.stringify(dim)}`);
      }
      scores[dim] = s;
    }
    const mean =
      Object.values(scores).reduce((a, b) => a + b, 0) /
      Object.values(scores).length;
    const passed = minMean === undefined ? undefined : mean >= minMean;
    return {
      scores,
      mean,
      passed,
      minMean,
      rationale: parsed.rationale,
      provider: result.provider,
      model: result.model,
    };
  }
}

function normalizeVerb(type: string): string {
  const t = type.trim();
  if (t.startsWith("llm.")) return t.slice(4);
  return t;
}

export function createLlmEngine(options: LlmEngineOptions): LlmEngine {
  return new LlmEngine(options);
}
