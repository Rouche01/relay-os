import type { MemoryHit, MemoryItem, WriteResult } from "@voltmem/client";

/**
 * Optional app-defined tag embedded in fact text (e.g. "outcome", "preference").
 * VoltMem also classifies domains server-side via its profile.
 */
export type MemoryDomainTag = string;

export interface AddFactOptions {
  /**
   * Fact kind sent to VoltMem `add` (skips the sidecar classifier).
   * `formatFact` still prefixes the text with `[domain]` so search stays readable.
   */
  domain?: MemoryDomainTag;
  /** Passed through to VoltMem as source (default: "relay") */
  source?: string;
  tenantId?: string;
  /** @deprecated Use tenantId. */
  userId?: string;
}

export interface SearchMemoryOptions {
  limit?: number;
  minScore?: number;
  tenantId?: string;
  /** @deprecated Use tenantId. */
  userId?: string;
}

/** One facet of an episodic VoltMem event (`POST …/events`). */
export interface MemoryEventFacet {
  content: string;
  /** Fact kind — required for a successful write after trim. */
  domain?: MemoryDomainTag;
  modality?: string;
  ttl_seconds?: number;
  expires_at?: number;
}

export interface AddEventOptions {
  source?: string;
  tenantId?: string;
  /** @deprecated Use tenantId. */
  userId?: string;
}

export interface GetEventOptions {
  tenantId?: string;
  /** @deprecated Use tenantId. */
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
   * Store a free-text fact via VoltMem `remember` (may confirm/merge similar facts).
   * Returns false if the write was skipped (fail-open).
   */
  addFact(text: string, options?: AddFactOptions): Promise<boolean>;

  /**
   * Store an episodic multi-facet event (unconditional insert; no confirm-merge).
   * Returns write results (with `action`) or `[]` when skipped / fail-open.
   */
  addEvent(
    eventId: string,
    facets: MemoryEventFacet[],
    options?: AddEventOptions
  ): Promise<WriteResult[]>;

  /**
   * List memories linked to an event id. Returns `[]` when missing / fail-open.
   */
  getEvent(eventId: string, options?: GetEventOptions): Promise<MemoryItem[]>;

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

export type { MemoryHit, MemoryItem, WriteResult };
