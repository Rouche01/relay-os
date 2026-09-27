import { NullContextEngine } from "./null-engine.js";
import type { ContextEngine } from "./types.js";
import { VoltMemContextEngine } from "./voltmem-engine.js";

export interface ContextEngineEnv {
  VOLTMEM_URL?: string;
  VOLTMEM_API_KEY?: string;
  VOLTMEM_USER_ID?: string;
  VOLTMEM_AGENT_ID?: string;
}

export interface CreateContextEngineOptions {
  /** Override env URL */
  baseUrl?: string;
  apiKey?: string;
  userId?: string;
  agentId?: string;
  /**
   * When true (default), missing VOLTMEM_URL yields NullContextEngine.
   * When false, throws if URL is missing.
   */
  optional?: boolean;
}

/**
 * Build a ContextEngine from env / options.
 * Fail-open by default: no URL → NullContextEngine (agent keeps running).
 */
export function createContextEngine(
  options: CreateContextEngineOptions = {},
  env: ContextEngineEnv & NodeJS.ProcessEnv = process.env
): ContextEngine {
  const baseUrl = options.baseUrl ?? env.VOLTMEM_URL;
  const optional = options.optional !== false;

  if (!baseUrl) {
    if (optional) {
      return new NullContextEngine();
    }
    throw new Error("VOLTMEM_URL is required when ContextEngine optional=false");
  }

  const userId =
    options.userId ?? env.VOLTMEM_USER_ID ?? "relay-local";
  const apiKey = options.apiKey ?? env.VOLTMEM_API_KEY;
  const agentId = options.agentId ?? env.VOLTMEM_AGENT_ID;

  return new VoltMemContextEngine({
    baseUrl,
    apiKey,
    userId,
    agentId,
  });
}
