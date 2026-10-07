import type {
  AddEventOptions as VoltMemAddEventOptions,
  AddOptions,
  Facet,
  MemoryHit,
  MemoryItem,
  SearchOptions,
  VoltMemClient,
  WriteResult,
} from "@voltmem/client";
import { formatFact, formatMemoryPromptBlock } from "./domains.js";
import type {
  AddEventOptions,
  AddFactOptions,
  ContextEngine,
  GetEventOptions,
  MemoryEventFacet,
  SearchMemoryOptions,
} from "./types.js";

export interface VoltMemContextEngineOptions {
  baseUrl: string;
  apiKey?: string;
  /** Default tenant (person or app bucket). */
  tenantId: string;
  /** Optional agent id tagged into source */
  agentId?: string;
  /** Log fail-open events (default: console.warn) */
  onWarn?: (message: string, err?: unknown) => void;
}

/**
 * VoltMem-backed Context Engine.
 * Fail-open: sidecar down → health false, addFact false, addEvent/getEvent/search [].
 *
 * Loads `@voltmem/client` via dynamic import so CJS consumers work with the
 * ESM-only npm package.
 */
export class VoltMemContextEngine implements ContextEngine {
  readonly name = "voltmem";
  private clientPromise: Promise<VoltMemClient> | null = null;
  private _available = false;
  private readonly onWarn: (message: string, err?: unknown) => void;
  private readonly agentId?: string;
  private readonly clientOptions: {
    baseUrl: string;
    apiKey?: string;
    tenantId: string;
  };

  constructor(options: VoltMemContextEngineOptions) {
    this.clientOptions = {
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      tenantId: options.tenantId,
    };
    this.agentId = options.agentId;
    this.onWarn =
      options.onWarn ??
      ((message, err) => {
        console.warn(`[context-engine] ${message}`, err ?? "");
      });
  }

  get available(): boolean {
    return this._available;
  }

  private async getClient(): Promise<VoltMemClient> {
    if (!this.clientPromise) {
      this.clientPromise = import("@voltmem/client").then(({ VoltMemClient }) => {
        return new VoltMemClient({
          baseUrl: this.clientOptions.baseUrl,
          apiKey: this.clientOptions.apiKey,
          tenantId: this.clientOptions.tenantId,
        });
      });
    }
    return this.clientPromise;
  }

  async health(): Promise<boolean> {
    try {
      const client = await this.getClient();
      const res = await client.health();
      this._available = res.status === "ok";
      return this._available;
    } catch (err) {
      this._available = false;
      this.onWarn("health check failed (fail-open)", err);
      return false;
    }
  }

  async addFact(text: string, options: AddFactOptions = {}): Promise<boolean> {
    const payload = formatFact(options.domain, text);
    if (!payload) return false;

    try {
      const client = await this.getClient();
      const source =
        options.source ??
        (this.agentId ? `relay:${this.agentId}` : "relay");
      const addOptions: AddOptions = { source };
      const tenantId = options.tenantId ?? options.userId;
      if (tenantId) addOptions.tenantId = tenantId;
      const domain = options.domain?.trim();
      if (domain) addOptions.domain = domain;
      await client.add(payload, addOptions);
      this._available = true;
      return true;
    } catch (err) {
      this._available = false;
      this.onWarn("addFact failed (fail-open)", err);
      return false;
    }
  }

  async addEvent(
    eventId: string,
    facets: MemoryEventFacet[],
    options: AddEventOptions = {}
  ): Promise<WriteResult[]> {
    const id = eventId.trim();
    if (!id) return [];

    const body: Facet[] = [];
    for (const facet of facets) {
      const domain = facet.domain?.trim();
      const content = formatFact(domain, facet.content);
      if (!domain || !content) continue;
      const row: Facet = { content, domain };
      if (facet.modality !== undefined) row.modality = facet.modality;
      if (facet.ttl_seconds !== undefined) row.ttl_seconds = facet.ttl_seconds;
      if (facet.expires_at !== undefined) row.expires_at = facet.expires_at;
      body.push(row);
    }
    if (body.length === 0) return [];

    try {
      const client = await this.getClient();
      const source =
        options.source ??
        (this.agentId ? `relay:${this.agentId}` : "relay");
      const eventOptions: VoltMemAddEventOptions = { source };
      const tenantId = options.tenantId ?? options.userId;
      if (tenantId) eventOptions.tenantId = tenantId;
      const results = await client.addEvent(id, body, eventOptions);
      this._available = true;
      return Array.isArray(results) ? results : [];
    } catch (err) {
      this._available = false;
      this.onWarn("addEvent failed (fail-open)", err);
      return [];
    }
  }

  async getEvent(
    eventId: string,
    options: GetEventOptions = {}
  ): Promise<MemoryItem[]> {
    const id = eventId.trim();
    if (!id) return [];

    try {
      const client = await this.getClient();
      const tenantId = options.tenantId ?? options.userId;
      const items = await client.getEvent(
        id,
        tenantId ? { tenantId } : {}
      );
      this._available = true;
      return Array.isArray(items) ? items : [];
    } catch (err) {
      this._available = false;
      this.onWarn("getEvent failed (fail-open)", err);
      return [];
    }
  }

  async search(query: string, options: SearchMemoryOptions = {}): Promise<MemoryHit[]> {
    try {
      const client = await this.getClient();
      const searchOptions: SearchOptions = { limit: options.limit ?? 5 };
      if (options.minScore !== undefined) searchOptions.minScore = options.minScore;
      const tenantId = options.tenantId ?? options.userId;
      if (tenantId) searchOptions.tenantId = tenantId;
      const hits = await client.search(query, searchOptions);
      this._available = true;
      return hits;
    } catch (err) {
      this._available = false;
      this.onWarn("search failed (fail-open)", err);
      return [];
    }
  }

  async rememberForPrompt(
    query: string,
    options: SearchMemoryOptions = {}
  ): Promise<string> {
    const hits = await this.search(query, options);
    return formatMemoryPromptBlock(hits.map((h) => h.memory));
  }
}
