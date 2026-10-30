import type { ConnectionCredentials } from "@relay/engines-api";
import type { ConnectionStore } from "./types.js";

/** In-memory store — tests, fixture hosts, Desk dry-run stubs. */
export class MemoryConnectionStore implements ConnectionStore {
  private readonly map: Map<string, ConnectionCredentials>;

  constructor(
    entries: Readonly<Record<string, ConnectionCredentials>> = {}
  ) {
    this.map = new Map(Object.entries(entries));
  }

  listIds(): readonly string[] {
    return [...this.map.keys()].sort();
  }

  get(id: string): ConnectionCredentials | undefined {
    return this.map.get(id);
  }

  set(id: string, credentials: ConnectionCredentials): void {
    this.map.set(id, credentials);
  }

  delete(id: string): boolean {
    return this.map.delete(id);
  }
}

export function createMemoryConnectionStore(
  entries?: Readonly<Record<string, ConnectionCredentials>>
): MemoryConnectionStore {
  return new MemoryConnectionStore(entries ?? {});
}
