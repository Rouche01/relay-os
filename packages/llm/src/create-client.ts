import { createAnthropicLlmClient } from "./anthropic.js";
import { createGeminiLlmClient } from "./gemini.js";
import type {
  CreateLlmClientOptions,
  LlmClient,
  LlmProviderId,
} from "./types.js";

export function parseLlmProviderId(
  raw: string | undefined,
  fallback: LlmProviderId = "gemini"
): LlmProviderId {
  const n = (raw ?? "").trim().toLowerCase();
  if (n === "anthropic" || n === "claude") return "anthropic";
  if (n === "gemini" || n === "google") return "gemini";
  if (!n) return fallback;
  throw new Error(
    `Unknown LLM provider "${raw}" (expected gemini|anthropic)`
  );
}

export function createLlmClient(opts: CreateLlmClientOptions): LlmClient {
  switch (opts.provider) {
    case "gemini":
      return createGeminiLlmClient(opts);
    case "anthropic":
      return createAnthropicLlmClient(opts);
    default: {
      const _exhaustive: never = opts.provider;
      throw new Error(`Unhandled LLM provider: ${String(_exhaustive)}`);
    }
  }
}
