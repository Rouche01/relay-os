/**
 * Spec v2.1 `once` — idempotency keys via the data engine.
 *
 * Store: `relay.once`
 * Key:   `{specHash}:{stepId}:{resolvedOnceKey}`
 *
 * Committed only after a successful non-simulated execute so shadow dry-runs
 * do not block a later live write.
 */

import type { ExecutionEngine } from "@relay/protocol";

export const RELAY_ONCE_STORE = "relay.once";

export type OnceRecord = {
  at: string;
  stepId: string;
  use: string;
  onceKey: string;
  committed: true;
};

/** Stable storage key for a resolved once value. */
export function onceStorageKey(
  specHash: string,
  stepId: string,
  resolved: unknown
): string {
  return `${specHash}:${stepId}:${stringifyOnceKey(resolved)}`;
}

export function stringifyOnceKey(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}

export async function lookupOnce(
  dataEngine: ExecutionEngine | undefined,
  storageKey: string
): Promise<OnceRecord | undefined> {
  if (!dataEngine) return undefined;
  const result = await dataEngine.execute({
    type: "get",
    params: { store: RELAY_ONCE_STORE, key: storageKey },
  });
  if (!result.success) {
    throw new Error(
      `once lookup failed: ${result.error ?? "data.get failed"}`
    );
  }
  const value = (result.data as { value?: unknown } | undefined)?.value;
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as OnceRecord).committed === true
  ) {
    return value as OnceRecord;
  }
  return undefined;
}

export async function commitOnce(
  dataEngine: ExecutionEngine | undefined,
  storageKey: string,
  record: OnceRecord
): Promise<void> {
  if (!dataEngine) {
    throw new Error("once commit requires a data engine");
  }
  const result = await dataEngine.execute({
    type: "put",
    params: {
      store: RELAY_ONCE_STORE,
      key: storageKey,
      value: record,
    },
  });
  if (!result.success) {
    throw new Error(
      `once commit failed: ${result.error ?? "data.put failed"}`
    );
  }
}

export function isDryRunSimulated(output: unknown): boolean {
  return (
    !!output &&
    typeof output === "object" &&
    (output as { dryRunSimulated?: boolean }).dryRunSimulated === true
  );
}
