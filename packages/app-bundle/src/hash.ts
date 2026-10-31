import { createHash } from "node:crypto";
import type { RelayAppBundle } from "./types.js";

type CanonicalBundlePayload = Omit<RelayAppBundle, "id" | "exportedAt">;

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortKeys(obj[key]);
    }
    return out;
  }
  return value;
}

/** Stable JSON for content addressing. */
export function canonicalRelayAppBundleJson(
  payload: CanonicalBundlePayload
): string {
  return JSON.stringify(sortKeys(payload));
}

export function hashRelayAppBundlePayload(
  payload: CanonicalBundlePayload
): string {
  return createHash("sha256")
    .update(canonicalRelayAppBundleJson(payload), "utf8")
    .digest("hex");
}

export function contentAddressId(payload: CanonicalBundlePayload): string {
  return `rapp_${hashRelayAppBundlePayload(payload)}`;
}
