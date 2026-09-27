import type { MemoryHit, WriteResult } from "@voltmem/client";

/**
 * Optional app-defined tag embedded in fact text (e.g. "outcome", "preference").
 * VoltMem also classifies domains server-side via its profile.
 */
export type MemoryDomainTag = string;

export interface AddFactOptions {
  domain?: MemoryDomainTag;
  /** Passed through to VoltMem as source (default: "relay") */
  source?: string;
  userId?: string;
}

export interface SearchMemoryOptions {
  limit?: number;
  minScore?: number;
  userId?: string;
}

/**
 * Context Engine — cross-run semantic memory for agentic apps.
 * Implementations must fail-open: never throw into the agent stage loop.
 * Domain/app-specific fact phrasing lives in each app, not here.
 */
export interface ContextEngine {
  readonly name: string;
  /** true when the last health check (or add/search) reached a live backend */
  readonly available: boolean;

  health(): Promise<boolean>;

  /**
   * Store a free-text fact. Returns false if the write was skipped (fail-open).
   */
  addFact(text: string, options?: AddFactOptions): Promise<boolean>;

  /**
   * Search memories. Returns [] if the backend is down (fail-open).
   */
  search(query: string, options?: SearchMemoryOptions): Promise<MemoryHit[]>;

  /**
   * Format search hits as a prompt block for drafters / LLM stages.
   * Returns "" when empty or unavailable.
   */
  rememberForPrompt(query: string, options?: SearchMemoryOptions): Promise<string>;
}

export type { MemoryHit, WriteResult };
