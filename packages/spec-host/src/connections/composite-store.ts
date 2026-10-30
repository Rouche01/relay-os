import type { ConnectionCredentials } from "@relay/engines-api";
import type { ConnectionStore } from "./types.js";

/**
 * First store that lists / returns a connection wins.
 * Useful: memory overrides → file → env → keychain.
 */
export class CompositeConnectionStore implements ConnectionStore {
  constructor(private readonly stores: readonly ConnectionStore[]) {}

  async listIds(): Promise<readonly string[]> {
    const ids = new Set<string>();
    for (const store of this.stores) {
      for (const id of await Promise.resolve(store.listIds())) {
        ids.add(id);
      }
    }
    return [...ids].sort();
  }

  async get(id: string): Promise<ConnectionCredentials | undefined> {
    for (const store of this.stores) {
      const known = await Promise.resolve(store.listIds());
      if (!known.includes(id)) continue;
      const creds = await Promise.resolve(store.get(id));
      if (creds) return creds;
    }
    return undefined;
  }
}

export function createCompositeConnectionStore(
  stores: readonly ConnectionStore[]
): CompositeConnectionStore {
  return new CompositeConnectionStore(stores);
}
