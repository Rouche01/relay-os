import { createHash } from "node:crypto";
import type { SpecV2Body } from "@relay/protocol";

/**
 * Canonical JSON for hashing — stable key order, Spec v2 body fields only.
 */
export function canonicalSpecV2Json(body: SpecV2Body): string {
  return stableStringify({
    goal: body.goal,
    connections: body.connections ?? null,
    services: body.services ?? null,
    budget: body.budget ?? null,
    rules: body.rules ?? [],
    steps: body.steps,
  });
}

/** SHA-256 hex of the canonical Spec v2 body. */
export function hashSpecV2(body: SpecV2Body): string {
  return createHash("sha256").update(canonicalSpecV2Json(body), "utf8").digest("hex");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
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
