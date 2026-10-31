import {
  parseDurationMs,
  ruleIdFromOutcomeScheduleId,
  type SpecV2Body,
  type SpecV2OutcomeMetric,
  type SpecV2OutcomeRule,
} from "@relay/protocol";
import type { SpecRunCheckpoint, RunStateStore } from "./checkpoint.js";
import { SpecHostError } from "./errors.js";
import { listRuns } from "./run-state-store.js";

export type OutcomeFollowUpStatus =
  | "pending"
  | "complete"
  | "failed"
  | "skipped";

/** Deferred metric measurement queued when a primary Spec run completes. */
export type OutcomeFollowUp = {
  ruleId: string;
  metricName: string;
  after: string;
  afterMs: number;
  parentRunId: string;
  specHash: string;
  dueAt: string;
  status: OutcomeFollowUpStatus;
  min?: number;
  max?: number;
  result?: OutcomeResult;
};

export type OutcomeResult = {
  measuredAt: string;
  /** Numeric observation when the host could measure one. */
  value?: number;
  /** Versus metric.min / metric.max when value is present. */
  passed?: boolean;
  detail?: unknown;
};

export type MeasureOutcomeFn = (
  followUp: OutcomeFollowUp,
  checkpoint: SpecRunCheckpoint
) =>
  | Promise<{ value?: number; detail?: unknown } | number | undefined>
  | { value?: number; detail?: unknown }
  | number
  | undefined;

/** Optional fail-open memory write (VoltMem / ContextEngine.addFact). */
export type OutcomeMemoryWriter = (input: {
  followUp: OutcomeFollowUp;
  result: OutcomeResult;
  checkpoint: SpecRunCheckpoint;
}) => void | Promise<void>;

function outcomeRules(body: Pick<SpecV2Body, "rules">): SpecV2OutcomeRule[] {
  return (body.rules ?? []).filter(
    (r): r is SpecV2OutcomeRule => r.kind === "outcome"
  );
}

function passedAgainstMetric(
  value: number | undefined,
  metric: Pick<SpecV2OutcomeMetric, "min" | "max">
): boolean | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  if (metric.min != null && value < metric.min) return false;
  if (metric.max != null && value > metric.max) return false;
  if (metric.min == null && metric.max == null) return undefined;
  return true;
}

/**
 * Build pending follow-ups for every outcome rule on a completed primary run.
 * Idempotent: keeps existing entries for the same ruleId.
 */
export function buildOutcomeFollowUps(
  checkpoint: SpecRunCheckpoint,
  opts?: { now?: string }
): OutcomeFollowUp[] {
  const nowIso = opts?.now ?? new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const prior = checkpoint.outcomeFollowUps ?? [];
  const byRule = new Map(prior.map((f) => [f.ruleId, f]));
  for (const rule of outcomeRules(checkpoint.body)) {
    if (byRule.has(rule.id)) continue;
    let afterMs: number;
    try {
      afterMs = parseDurationMs(rule.metric.after);
    } catch {
      continue;
    }
    byRule.set(rule.id, {
      ruleId: rule.id,
      metricName: rule.metric.name,
      after: rule.metric.after,
      afterMs,
      parentRunId: checkpoint.runId,
      specHash: checkpoint.specHash,
      dueAt: new Date(nowMs + afterMs).toISOString(),
      status: "pending",
      min: rule.metric.min,
      max: rule.metric.max,
    });
  }
  return [...byRule.values()];
}

/** Attach pending outcome follow-ups when a run reaches complete. */
export function withEnqueuedOutcomeFollowUps(
  checkpoint: SpecRunCheckpoint,
  opts?: { now?: string }
): SpecRunCheckpoint {
  if (checkpoint.status !== "complete") return checkpoint;
  if (!outcomeRules(checkpoint.body).length) return checkpoint;
  const outcomeFollowUps = buildOutcomeFollowUps(checkpoint, opts);
  return { ...checkpoint, outcomeFollowUps };
}

export async function listDueOutcomeFollowUps(
  store: RunStateStore,
  query: {
    ruleId?: string;
    specHash?: string;
    now?: string;
    limit?: number;
  } = {}
): Promise<Array<{ checkpoint: SpecRunCheckpoint; followUp: OutcomeFollowUp }>> {
  const nowIso = query.now ?? new Date().toISOString();
  const runs = await listRuns(store, {
    specHash: query.specHash,
    status: "complete",
    newestFirst: true,
  });
  const out: Array<{
    checkpoint: SpecRunCheckpoint;
    followUp: OutcomeFollowUp;
  }> = [];
  for (const cp of runs) {
    for (const followUp of cp.outcomeFollowUps ?? []) {
      if (followUp.status !== "pending") continue;
      if (query.ruleId && followUp.ruleId !== query.ruleId) continue;
      if (followUp.dueAt > nowIso) continue;
      out.push({ checkpoint: cp, followUp });
      if (query.limit != null && out.length >= query.limit) return out;
    }
  }
  return out;
}

function normalizeMeasure(
  raw: { value?: number; detail?: unknown } | number | undefined
): { value?: number; detail?: unknown } {
  if (raw === undefined) return {};
  if (typeof raw === "number") return { value: raw };
  return raw;
}

/**
 * Measure one pending follow-up on its parent run and persist the result.
 */
export async function recordOutcomeFollowUp(
  store: RunStateStore,
  input: {
    parentRunId: string;
    ruleId: string;
    measure?: MeasureOutcomeFn;
    remember?: OutcomeMemoryWriter;
    now?: string;
  }
): Promise<SpecRunCheckpoint> {
  const cp = await store.get(input.parentRunId);
  if (!cp) {
    throw new SpecHostError(
      "run_not_found",
      `Run not found: ${input.parentRunId}`,
      { runId: input.parentRunId }
    );
  }
  const followUps = [...(cp.outcomeFollowUps ?? [])];
  const idx = followUps.findIndex((f) => f.ruleId === input.ruleId);
  if (idx < 0) {
    throw new SpecHostError(
      "outcome_followup_missing",
      `No outcome follow-up ${input.ruleId} on run ${input.parentRunId}`,
      { runId: input.parentRunId, ruleId: input.ruleId }
    );
  }
  const followUp = followUps[idx]!;
  if (followUp.status === "complete" && followUp.result) {
    return cp;
  }

  const now = input.now ?? new Date().toISOString();
  let measured: { value?: number; detail?: unknown } = {};
  try {
    measured = normalizeMeasure(
      await input.measure?.(followUp, cp)
    );
  } catch (err) {
    const failed: OutcomeFollowUp = {
      ...followUp,
      status: "failed",
      result: {
        measuredAt: now,
        detail: {
          error: err instanceof Error ? err.message : String(err),
        },
      },
    };
    followUps[idx] = failed;
    const next = {
      ...cp,
      outcomeFollowUps: followUps,
      updatedAt: now,
      savedAt: now,
    };
    await store.save(next);
    return next;
  }

  const result: OutcomeResult = {
    measuredAt: now,
    value: measured.value,
    passed: passedAgainstMetric(measured.value, {
      min: followUp.min,
      max: followUp.max,
    }),
    detail: measured.detail,
  };
  const completed: OutcomeFollowUp = {
    ...followUp,
    status: "complete",
    result,
  };
  followUps[idx] = completed;
  const next: SpecRunCheckpoint = {
    ...cp,
    outcomeFollowUps: followUps,
    updatedAt: now,
    savedAt: now,
  };
  await store.save(next);
  try {
    await input.remember?.({ followUp: completed, result, checkpoint: next });
  } catch {
    // VoltMem / memory writers fail open.
  }
  return next;
}

/**
 * Process due follow-ups for a schedule/entrypoint id (`outcome_<ruleId>`).
 * Returns how many were recorded.
 */
export async function processDueOutcomeFollowUps(
  store: RunStateStore,
  input: {
    /** Schedule / entrypoint id, or bare rule id. */
    entrypointOrRuleId: string;
    specHash?: string;
    measure?: MeasureOutcomeFn;
    remember?: OutcomeMemoryWriter;
    now?: string;
    limit?: number;
  }
): Promise<{ processed: number; runIds: string[] }> {
  const ruleId =
    ruleIdFromOutcomeScheduleId(input.entrypointOrRuleId) ??
    input.entrypointOrRuleId;
  const due = await listDueOutcomeFollowUps(store, {
    ruleId,
    specHash: input.specHash,
    now: input.now,
    limit: input.limit ?? 50,
  });
  const runIds: string[] = [];
  for (const { followUp } of due) {
    await recordOutcomeFollowUp(store, {
      parentRunId: followUp.parentRunId,
      ruleId: followUp.ruleId,
      measure: input.measure,
      remember: input.remember,
      now: input.now,
    });
    runIds.push(followUp.parentRunId);
  }
  return { processed: runIds.length, runIds };
}
