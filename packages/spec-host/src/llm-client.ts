import {
  createLlmClient,
  parseLlmProviderId,
  type LlmClient,
} from "@relay/llm";
import { SpecHostError } from "./errors.js";
import type { SpecHostMode } from "./types.js";

/**
 * Try to build a live LLM client from env (`LLM_PROVIDER`, API keys).
 * Returns null when keys/provider are missing — never throws for "not configured".
 */
export function tryCreateLiveLlmClient(
  env: NodeJS.ProcessEnv = process.env
): LlmClient | null {
  if (
    env.RELAY_SPEC_SCAFFOLD_STUB === "1" ||
    env.RELAY_SPEC_SCAFFOLD_STUB === "true"
  ) {
    return null;
  }
  try {
    const provider = parseLlmProviderId(env.LLM_PROVIDER);
    return createLlmClient({ provider });
  } catch {
    return null;
  }
}

/** Live client or throw with a structured host error. */
export function createLiveLlmClient(
  env: NodeJS.ProcessEnv = process.env
): LlmClient {
  const client = tryCreateLiveLlmClient(env);
  if (!client) {
    throw new SpecHostError(
      "missing_llm_client",
      "No live LLM client: set LLM_PROVIDER + provider API key (or pass llmClient). Stub mode via RELAY_SPEC_SCAFFOLD_STUB=1 disables live LLM."
    );
  }
  return client;
}

/**
 * Resolve the LLM for a run: explicit client wins; else live for shadow/live;
 * fixture requires an explicit client (usually a stub).
 */
export function resolveRunLlmClient(options: {
  mode: SpecHostMode;
  llmClient?: LlmClient;
  env?: NodeJS.ProcessEnv;
}): LlmClient {
  if (options.llmClient) return options.llmClient;
  if (options.mode === "fixture") {
    throw new SpecHostError(
      "missing_llm_client",
      "fixture mode requires an explicit llmClient (stub or live)"
    );
  }
  return createLiveLlmClient(options.env);
}
