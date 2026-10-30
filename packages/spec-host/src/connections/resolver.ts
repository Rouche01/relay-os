import type { ConnectionResolver } from "@relay/engines-api";
import type { SpecV2Body } from "@relay/protocol";
import { SpecHostError } from "../errors.js";
import type { ConnectionStore } from "./types.js";

/** Build engines-api ConnectionResolver from a ConnectionStore. */
export function connectionResolverFromStore(
  store: ConnectionStore
): ConnectionResolver {
  return async (connectionId) => {
    const creds = await Promise.resolve(store.get(connectionId));
    if (!creds) {
      throw new SpecHostError(
        "missing_connection",
        `Unknown or unset connection ${JSON.stringify(connectionId)}`,
        { connectionId }
      );
    }
    return creds;
  };
}

/** Collect connection refs declared on the Spec (top-level + step args). */
export function collectSpecConnectionRefs(
  body: Pick<SpecV2Body, "connections" | "steps">
): string[] {
  const ids = new Set<string>();
  for (const c of body.connections ?? []) {
    if (typeof c === "string" && c.trim()) ids.add(c.trim());
  }
  for (const step of body.steps ?? []) {
    const conn = step.args?.connection;
    if (typeof conn === "string" && conn.trim()) ids.add(conn.trim());
  }
  return [...ids].sort();
}

/**
 * Fail closed if Spec needs connections the store does not know.
 * Returns the store's id list for validator `knownConnections`.
 */
export async function assertConnectionsAvailable(
  body: Pick<SpecV2Body, "connections" | "steps">,
  store: ConnectionStore
): Promise<readonly string[]> {
  const known = [...(await Promise.resolve(store.listIds()))];
  const knownSet = new Set(known);
  const needed = collectSpecConnectionRefs(body);
  const missing = needed.filter((id) => !knownSet.has(id));
  if (missing.length) {
    throw new SpecHostError(
      "missing_connection",
      `Spec requires connections not in the store: ${missing.join(", ")}`,
      { missing, known }
    );
  }
  return known;
}
