import type { SpecV2Body } from "@relay/protocol";
import { SpecHostError } from "./errors.js";
import type { SpecHostMode } from "./types.js";

export type ResolvedHostMode = {
  mode: SpecHostMode;
  /** API engine dryRun — irreversible methods simulate when true. */
  dryRun: boolean;
  /** When true, fetch throws (offline CI). */
  blockNetwork: boolean;
};

/**
 * Resolve mode defaults:
 * - fixture → dryRun true, blockNetwork true (caller fixtures)
 * - shadow → dryRun true (always), blockNetwork false (live reads)
 * - live → dryRun false only when Spec budget.dryRun === false; network on
 *
 * Explicit dryRun / blockNetwork overrides still win except shadow always
 * forces dryRun true (shadow must never perform irreversible writes).
 */
export function resolveHostDefaults(options: {
  mode?: SpecHostMode;
  dryRun?: boolean;
  blockNetwork?: boolean;
  budgetDryRun?: boolean;
}): ResolvedHostMode {
  const mode = options.mode ?? "fixture";

  if (mode === "shadow") {
    return {
      mode,
      dryRun: true,
      blockNetwork: options.blockNetwork ?? false,
    };
  }

  if (mode === "live") {
    const dryRun =
      options.dryRun ??
      (options.budgetDryRun === false ? false : true);
    return {
      mode,
      dryRun,
      blockNetwork: options.blockNetwork ?? false,
    };
  }

  // fixture
  return {
    mode: "fixture",
    dryRun: options.dryRun ?? options.budgetDryRun ?? true,
    blockNetwork: options.blockNetwork ?? true,
  };
}

/**
 * Fail closed before engines start when mode + Spec budget disagree.
 * Live requires budget.dryRun === false (and host dryRun false after resolve).
 */
export function assertModeAllowed(
  mode: SpecHostMode,
  body: Pick<SpecV2Body, "budget">,
  resolved: Pick<ResolvedHostMode, "dryRun" | "blockNetwork">
): void {
  if (mode === "live") {
    if (body.budget?.dryRun !== false) {
      throw new SpecHostError(
        "live_requires_budget",
        "live mode requires Spec budget.dryRun: false (use shadow for live reads + simulated writes)",
        { budget: body.budget ?? null }
      );
    }
    if (resolved.dryRun) {
      throw new SpecHostError(
        "live_requires_dryRun_false",
        "live mode cannot run with dryRun=true — omit dryRun override or set budget.dryRun: false"
      );
    }
  }

  if (mode === "shadow" && !resolved.dryRun) {
    throw new SpecHostError(
      "shadow_requires_dryRun",
      "shadow mode must keep dryRun=true so irreversible writes stay simulated"
    );
  }

  if (mode === "fixture" && !resolved.blockNetwork) {
    // Allowed if caller opts in (e.g. hybrid), but warn via no throw —
    // fixtures still take precedence when matched.
  }
}

/** Count API shadow / dry-run simulated writes in step outputs. */
export function countSimulatedWrites(
  stepOutputs: Record<string, unknown>
): number {
  let n = 0;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const o = value as Record<string, unknown>;
    if (o.dryRunSimulated === true) n += 1;
    for (const v of Object.values(o)) {
      if (v && typeof v === "object") visit(v);
    }
  };
  for (const out of Object.values(stepOutputs)) visit(out);
  return n;
}
