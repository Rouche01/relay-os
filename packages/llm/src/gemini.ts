import type {
  CreateLlmClientOptions,
  LlmClient,
  LlmJsonRequest,
  LlmJsonResult,
  LlmMessage,
} from "./types.js";
import {
  DEFAULT_GEMINI_MODEL,
  messageText,
} from "./types.js";

/** Map a JSON Schema fragment into @google/genai Type-tagged schema. */
export function jsonSchemaToGemini(
  schema: Record<string, unknown>,
  Type: {
    OBJECT: unknown;
    STRING: unknown;
    INTEGER: unknown;
    NUMBER: unknown;
    BOOLEAN: unknown;
    ARRAY: unknown;
  }
): Record<string, unknown> {
  const t = String(schema.type ?? "object").toLowerCase();
  if (t === "object") {
    const propsIn = (schema.properties ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    const properties: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(propsIn)) {
      properties[k] = jsonSchemaToGemini(v, Type);
    }
    const out: Record<string, unknown> = {
      type: Type.OBJECT,
      properties,
    };
    if (Array.isArray(schema.required)) out.required = schema.required;
    return out;
  }
  if (t === "string") {
    const out: Record<string, unknown> = { type: Type.STRING };
    if (typeof schema.description === "string") {
      out.description = schema.description;
    }
    return out;
  }
  if (t === "integer") {
    const out: Record<string, unknown> = { type: Type.INTEGER };
    if (typeof schema.description === "string") {
      out.description = schema.description;
    }
    return out;
  }
  if (t === "number") {
    const out: Record<string, unknown> = { type: Type.NUMBER };
    if (typeof schema.description === "string") {
      out.description = schema.description;
    }
    return out;
  }
  if (t === "boolean") {
    return { type: Type.BOOLEAN };
  }
  if (t === "array") {
    const items = (schema.items ?? { type: "string" }) as Record<
      string,
      unknown
    >;
    return {
      type: Type.ARRAY,
      items: jsonSchemaToGemini(items, Type),
    };
  }
  return { type: Type.STRING };
}

function splitSystem(messages: LlmMessage[]): {
  system?: string;
  contents: string;
} {
  const systems: string[] = [];
  const rest: string[] = [];
  for (const m of messages) {
    const text = messageText(m.content).trim();
    if (!text) continue;
    if (m.role === "system") systems.push(text);
    else rest.push(text);
  }
  return {
    system: systems.length ? systems.join("\n\n") : undefined,
    contents: rest.join("\n\n"),
  };
}

export class GeminiLlmClient implements LlmClient {
  readonly provider = "gemini" as const;
  private readonly apiKey: string;
  private readonly defaultModel: string;

  constructor(opts: { apiKey: string; model?: string }) {
    this.apiKey = opts.apiKey;
    this.defaultModel = opts.model?.trim() || DEFAULT_GEMINI_MODEL;
  }

  async completeJson(req: LlmJsonRequest): Promise<LlmJsonResult> {
    const genai = await import("@google/genai");
    const { Type, HarmCategory, HarmBlockThreshold } = genai;
    const ai = new genai.GoogleGenAI({ apiKey: this.apiKey });
    const model = req.model?.trim() || this.defaultModel;
    const { system, contents } = splitSystem(req.messages);
    if (!contents) {
      throw new Error("GeminiLlmClient: no user/assistant content in messages");
    }

    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        ...(system ? { systemInstruction: system } : {}),
        responseMimeType: "application/json",
        responseSchema: jsonSchemaToGemini(req.schema, Type),
        temperature: req.temperature ?? 0.4,
        safetySettings: [
          {
            category: HarmCategory.HARM_CATEGORY_HARASSMENT,
            threshold: HarmBlockThreshold.BLOCK_NONE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
            threshold: HarmBlockThreshold.BLOCK_NONE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
            threshold: HarmBlockThreshold.BLOCK_NONE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            threshold: HarmBlockThreshold.BLOCK_NONE,
          },
        ],
      },
    });

    const text = (response.text ?? "").trim();
    if (!text) {
      throw new Error("GeminiLlmClient: empty response text");
    }
    return { text, provider: "gemini", model };
  }
}

export function resolveGeminiApiKey(explicit?: string): string | undefined {
  const key = (explicit ?? process.env.GEMINI_API_KEY ?? "").trim();
  return key || undefined;
}

export function createGeminiLlmClient(
  opts: CreateLlmClientOptions
): GeminiLlmClient {
  const apiKey = resolveGeminiApiKey(opts.apiKey);
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY unset (required for provider=gemini)");
  }
  return new GeminiLlmClient({ apiKey, model: opts.model });
}
