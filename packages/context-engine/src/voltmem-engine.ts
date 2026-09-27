import type { MemoryHit, VoltMemClient } from "@voltmem/client";
import { formatFact, formatMemoryPromptBlock } from "./domains.js";
import type {
  AddFactOptions,
  ContextEngine,
  SearchMemoryOptions,
} from "./types.js";

export interface VoltMemContextEngineOptions {
  baseUrl: string;
  apiKey?: string;
  /** Default tenant / user scope */
  userId: string;
  /** Optional agent id tagged into source */
  agentId?: string;
  /** Log fail-open events (default: console.warn) */
  onWarn?: (message: string, err?: unknown) => void;
}

/**
 * VoltMem-backed Context Engine.
 * Fail-open: sidecar down → health false, addFact false, search [].
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
    userId: string;
  };

  constructor(options: VoltMemContextEngineOptions) {
    this.clientOptions = {
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      userId: options.userId,
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
          userId: this.clientOptions.userId,
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
      await client.add(payload, {
        source,
        userId: options.userId,
      });
      this._available = true;
      return true;
    } catch (err) {
      this._available = false;
      this.onWarn("addFact failed (fail-open)", err);
      return false;
    }
  }

  async search(query: string, options: SearchMemoryOptions = {}): Promise<MemoryHit[]> {
    try {
      const client = await this.getClient();
      const hits = await client.search(query, {
        limit: options.limit ?? 5,
        minScore: options.minScore,
        userId: options.userId,
      });
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
