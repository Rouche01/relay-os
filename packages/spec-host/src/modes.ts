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
  return collectSimulatedWrites(stepOutputs).length;
}

/** One simulated / shadow write for Desk side-by-side review. */
export type SimulatedWrite = {
  stepId?: string;
  source: "stepOutput" | "evidence";
  detail: unknown;
};

/**
 * Collect dryRunSimulated step outputs and evidence entries tagged
 * `shadowWrite` / `dryRunSimulated` (deduped by stepId when both exist).
 */
export function collectSimulatedWrites(
  stepOutputs: Record<string, unknown> = {},
  evidence: ReadonlyArray<{
    stepId?: string;
    detail?: unknown;
  }> = []
): SimulatedWrite[] {
  const out: SimulatedWrite[] = [];
  const seenSteps = new Set<string>();

  const visit = (stepId: string | undefined, value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(stepId, item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const o = value as Record<string, unknown>;
    if (o.dryRunSimulated === true) {
      out.push({ stepId, source: "stepOutput", detail: o });
      if (stepId) seenSteps.add(stepId);
      return;
    }
    for (const v of Object.values(o)) {
      if (v && typeof v === "object") visit(stepId, v);
    }
  };

  for (const [stepId, value] of Object.entries(stepOutputs)) {
    visit(stepId, value);
  }

  for (const e of evidence) {
    const detail = e.detail;
    if (!detail || typeof detail !== "object") continue;
    const d = detail as Record<string, unknown>;
    if (d.shadowWrite !== true && d.dryRunSimulated !== true) continue;
    if (e.stepId && seenSteps.has(e.stepId)) continue;
    out.push({
      stepId: e.stepId,
      source: "evidence",
      detail,
    });
    if (e.stepId) seenSteps.add(e.stepId);
  }

  return out;
}
