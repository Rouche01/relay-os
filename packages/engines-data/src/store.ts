/**
 * Logical key-value / list store for Spec v2 data.* capabilities.
 * Apps may wrap action-store or VoltMem; MemoryDataStore is the default.
 */

export type DataStore = {
  get(store: string, key?: string): Promise<unknown>;
  put(store: string, key: string, value: unknown): Promise<void>;
  /**
   * Query records. When `query` is empty, return all values in the store
   * (list for append-only stores, object values for keyed maps).
   */
  query(
    store: string,
    query?: Record<string, unknown>
  ): Promise<unknown[]>;
  append(store: string, value: unknown): Promise<void>;
};

/** In-memory DataStore — tests and local dry-run. */
export class MemoryDataStore implements DataStore {
  /** Keyed maps: store → key → value */
  private readonly maps = new Map<string, Map<string, unknown>>();
  /** Append logs: store → values[] */
  private readonly lists = new Map<string, unknown[]>();

  async get(store: string, key?: string): Promise<unknown> {
    if (key === undefined || key === "") {
      const list = this.lists.get(store);
      if (list) return [...list];
      const map = this.maps.get(store);
      if (map) return Object.fromEntries(map);
      return undefined;
    }
    return this.maps.get(store)?.get(key);
  }

  async put(store: string, key: string, value: unknown): Promise<void> {
    if (!key) throw new Error("data.put requires key");
    let map = this.maps.get(store);
    if (!map) {
      map = new Map();
      this.maps.set(store, map);
    }
    map.set(key, value);
  }

  async query(
    store: string,
    query?: Record<string, unknown>
  ): Promise<unknown[]> {
    const list = this.lists.get(store);
    if (list) {
      if (!query || Object.keys(query).length === 0) return [...list];
      return list.filter((item) => matchesQuery(item, query));
    }
    const map = this.maps.get(store);
    if (!map) return [];
    const values = [...map.entries()].map(([k, v]) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? { key: k, ...(v as object) }
        : { key: k, value: v }
    );
    if (!query || Object.keys(query).length === 0) return values;
    return values.filter((item) => matchesQuery(item, query));
  }

  async append(store: string, value: unknown): Promise<void> {
    let list = this.lists.get(store);
    if (!list) {
      list = [];
      this.lists.set(store, list);
    }
    list.push(value);
  }
}

function matchesQuery(
  item: unknown,
  query: Record<string, unknown>
): boolean {
  if (!item || typeof item !== "object") return false;
  const row = item as Record<string, unknown>;
  for (const [k, v] of Object.entries(query)) {
    if (JSON.stringify(row[k]) !== JSON.stringify(v)) return false;
  }
  return true;
}
