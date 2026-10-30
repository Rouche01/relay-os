/**
 * File-backed {@link DataStore} — persists maps/lists as JSON for once keys
 * and Spec learning logs across process restarts.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { DataStore } from "./store.js";

type FileDocument = {
  version: 1;
  maps: Record<string, Record<string, unknown>>;
  lists: Record<string, unknown[]>;
};

export type FileJsonDataStoreOptions = {
  /** Absolute or relative path to the JSON file. */
  path: string;
};

export class FileJsonDataStore implements DataStore {
  private readonly path: string;
  private maps = new Map<string, Map<string, unknown>>();
  private lists = new Map<string, unknown[]>();
  private loaded = false;

  constructor(options: FileJsonDataStoreOptions) {
    this.path = options.path;
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = readFileSync(this.path, "utf8");
      const doc = JSON.parse(raw) as FileDocument;
      if (doc?.version === 1 && doc.maps && typeof doc.maps === "object") {
        for (const [store, entries] of Object.entries(doc.maps)) {
          this.maps.set(store, new Map(Object.entries(entries ?? {})));
        }
      }
      if (doc?.version === 1 && doc.lists && typeof doc.lists === "object") {
        for (const [store, values] of Object.entries(doc.lists)) {
          this.lists.set(store, Array.isArray(values) ? [...values] : []);
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") throw err;
    }
  }

  private persist(): void {
    const doc: FileDocument = {
      version: 1,
      maps: {},
      lists: {},
    };
    for (const [store, map] of this.maps) {
      doc.maps[store] = Object.fromEntries(map);
    }
    for (const [store, list] of this.lists) {
      doc.lists[store] = [...list];
    }
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(doc, null, 2) + "\n", "utf8");
    renameSync(tmp, this.path);
  }

  async get(store: string, key?: string): Promise<unknown> {
    this.ensureLoaded();
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
    this.ensureLoaded();
    let map = this.maps.get(store);
    if (!map) {
      map = new Map();
      this.maps.set(store, map);
    }
    map.set(key, value);
    this.persist();
  }

  async query(
    store: string,
    query?: Record<string, unknown>
  ): Promise<unknown[]> {
    this.ensureLoaded();
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
    this.ensureLoaded();
    let list = this.lists.get(store);
    if (!list) {
      list = [];
      this.lists.set(store, list);
    }
    list.push(value);
    this.persist();
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

export function createFileJsonDataStore(
  options: FileJsonDataStoreOptions
): FileJsonDataStore {
  return new FileJsonDataStore(options);
}
