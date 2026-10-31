import { readFileSync, writeFileSync } from "node:fs";
import { RelayAppBundleError } from "./errors.js";
import type { RelayAppBundle } from "./types.js";
import { verifyRelayAppBundle } from "./verify.js";

/** Serialize a verified-shape bundle to JSON. */
export function exportRelayAppBundleJson(bundle: RelayAppBundle): string {
  return JSON.stringify(bundle, null, 2);
}

export function writeRelayAppBundle(
  path: string,
  bundle: RelayAppBundle
): void {
  writeFileSync(path, exportRelayAppBundleJson(bundle), "utf8");
}

/**
 * Parse + verify a bundle from JSON text (import path).
 * Fails closed on hash / freeze / descriptor mismatches.
 */
export function importRelayAppBundleJson(raw: string): RelayAppBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (err) {
    throw new RelayAppBundleError(
      "invalid_json",
      err instanceof Error ? err.message : "Invalid JSON"
    );
  }
  const verified = verifyRelayAppBundle(parsed);
  if (!verified.ok) {
    throw new RelayAppBundleError(
      "bundle_invalid",
      verified.errors.map((e) => `[${e.code}] ${e.message}`).join("; "),
      { errors: verified.errors }
    );
  }
  return verified.bundle;
}

export function readRelayAppBundle(path: string): RelayAppBundle {
  return importRelayAppBundleJson(readFileSync(path, "utf8"));
}
