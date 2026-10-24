/**
 * Spec persistence — Intent + Spec as a durable bundle for replay / resume / demo.
 *
 * Drivers live outside this package (e.g. file JSON under an app dataDir).
 * Protocol only defines the record shape and the store port.
 */

import type { Intent } from "./intent";
import type { Spec } from "./spec";

/** Durable unit: the Intent that was compiled and the Spec that governs a run. */
export interface SpecBundle {
  /** Same as `spec.id` — primary lookup key. */
  id: string;
  intent: Intent;
  spec: Spec;
  /** ISO timestamp of last put. */
  savedAt: string;
  /** Optional app that produced the bundle (e.g. community-engager). */
  appId?: string;
}

export type SpecListFilter = {
  appId?: string;
  /** Inclusive ISO lower bound on savedAt */
  savedAfter?: string;
  limit?: number;
};

/**
 * Persistence port for Intent+Spec bundles.
 * Apps depend on this interface — not on file paths or SQL.
 */
export interface SpecStore {
  put(bundle: SpecBundle): Promise<void>;
  get(id: string): Promise<SpecBundle | null>;
  /** Lookup by Intent.id when the Spec id is unknown. */
  getByIntentId?(intentId: string): Promise<SpecBundle | null>;
  list(filter?: SpecListFilter): Promise<SpecBundle[]>;
  delete?(id: string): Promise<boolean>;
}

/** Build a SpecBundle from Intent + Spec (id = spec.id). */
export function createSpecBundle(
  intent: Intent,
  spec: Spec,
  opts?: { appId?: string; savedAt?: string }
): SpecBundle {
  return {
    id: spec.id,
    intent,
    spec,
    savedAt: opts?.savedAt ?? new Date().toISOString(),
    ...(opts?.appId ? { appId: opts.appId } : {}),
  };
}
