export type LlmProviderId = "gemini" | "anthropic";

export type LlmRole = "system" | "user" | "assistant";

export type LlmContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; url: string };

export interface LlmMessage {
  role: LlmRole;
  content: string | LlmContentPart[];
}

export interface LlmJsonRequest {
  messages: LlmMessage[];
  /** JSON Schema object; providers map to native structured output. */
  schema: Record<string, unknown>;
  model?: string;
  temperature?: number;
}

export interface LlmJsonResult {
  /** JSON string matching the request schema. */
  text: string;
  provider: LlmProviderId;
  model: string;
}

export interface LlmClient {
  readonly provider: LlmProviderId;
  completeJson(req: LlmJsonRequest): Promise<LlmJsonResult>;
}

export interface CreateLlmClientOptions {
  provider: LlmProviderId;
  apiKey?: string;
  model?: string;
}

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5";

export function messageText(content: LlmMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}
