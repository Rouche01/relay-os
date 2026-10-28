import type {
  EngineAction,
  EngineResult,
  ExecutionEngine,
} from "@relay/protocol";
import { MemoryDataStore, type DataStore } from "./store.js";

export type DataEngineOptions = {
  store?: DataStore;
  /**
   * When true (default), `put` is allowed. Set false to refuse puts under
   * dry-run policies (append still works for local learning logs).
   */
  allowPut?: boolean;
};

/**
 * Spec v2 data.* capabilities over a {@link DataStore}.
 *
 * Action types: `get` | `put` | `query` | `append`
 * (also accepts `data.get` etc.).
 */
export class DataEngine implements ExecutionEngine {
  public readonly type = "data" as const;

  private readonly store: DataStore;
  private readonly allowPut: boolean;

  constructor(options: DataEngineOptions = {}) {
    this.store = options.store ?? new MemoryDataStore();
    this.allowPut = options.allowPut ?? true;
  }

  /** Underlying store (tests / host wiring). */
  getStore(): DataStore {
    return this.store;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async teardown(): Promise<void> {}

  async execute(action: EngineAction): Promise<EngineResult> {
    const verb = normalizeVerb(action.type);
    try {
      switch (verb) {
        case "get":
          return { success: true, data: await this.get(action.params) };
        case "put":
          return { success: true, data: await this.put(action.params) };
        case "query":
          return { success: true, data: await this.query(action.params) };
        case "append":
          return { success: true, data: await this.append(action.params) };
        default:
          return {
            success: false,
            error: `Unsupported data action: ${action.type}`,
          };
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async get(params: Record<string, unknown>): Promise<unknown> {
    const store = requireStore(params);
    const key =
      typeof params.key === "string" && params.key.trim()
        ? params.key.trim()
        : undefined;
    const value = await this.store.get(store, key);
    return { store, key, value };
  }

  private async put(params: Record<string, unknown>): Promise<unknown> {
    if (!this.allowPut) {
      throw new Error("data.put refused (allowPut=false)");
    }
    const store = requireStore(params);
    const key = String(params.key ?? "").trim();
    if (!key) throw new Error("data.put requires key");
    if (!("value" in params)) throw new Error("data.put requires value");
    await this.store.put(store, key, params.value);
    return { store, key, written: true };
  }

  private async query(params: Record<string, unknown>): Promise<unknown> {
    const store = requireStore(params);
    const query =
      params.query && typeof params.query === "object" && !Array.isArray(params.query)
        ? (params.query as Record<string, unknown>)
        : undefined;
    const items = await this.store.query(store, query);
    return { store, items, count: items.length };
  }

  private async append(params: Record<string, unknown>): Promise<unknown> {
    const store = requireStore(params);
    if (!("value" in params)) throw new Error("data.append requires value");
    await this.store.append(store, params.value);
    return { store, appended: true };
  }
}

function requireStore(params: Record<string, unknown>): string {
  const store = String(params.store ?? "").trim();
  if (!store) throw new Error("data.* requires store");
  return store;
}

function normalizeVerb(type: string): string {
  const t = type.trim();
  if (t.startsWith("data.")) return t.slice(5);
  return t;
}

export function createDataEngine(options?: DataEngineOptions): DataEngine {
  return new DataEngine(options);
}
