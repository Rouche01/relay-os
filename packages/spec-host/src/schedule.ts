import type { SpecV2Body } from "@relay/protocol";
import {
  assertSchedulesValid,
  DEFAULT_ENTRYPOINT,
  isOutcomeScheduleId,
  listEnabledSchedules,
} from "@relay/protocol";
import { lowerSpecV2 } from "@relay/spec-lower";
import {
  SchedulerHost,
  type ScheduleInvoker,
  type SchedulerHostOptions,
} from "@relay/scheduler";
import type { SpecRunCheckpoint, RunStateStore } from "./checkpoint.js";
import { SpecHostError } from "./errors.js";
import {
  processDueOutcomeFollowUps,
  type MeasureOutcomeFn,
  type OutcomeMemoryWriter,
} from "./outcome-followups.js";
import { runSpec } from "./run.js";
import { assertShadowGate } from "./shadow-gate.js";
import type { RunSpecOptions, RunSpecResult } from "./types.js";

export type SpecScheduleRunFactory = (
  ctx: Parameters<ScheduleInvoker>[1],
  entrypoint: string
) => Promise<RunSpecResult | void> | RunSpecResult | void;

/**
 * Build a scheduler invoker that runs a Spec via {@link runSpec}.
 * Outcome entrypoints (`outcome_*`) should use {@link createHostScheduleInvoker}.
 */
export function createSpecScheduleInvoker(
  factory: SpecScheduleRunFactory
): ScheduleInvoker {
  return async (entrypoint, ctx) => {
    await factory(ctx, entrypoint);
  };
}

/**
 * Convenience invoker that freezes call-site `runSpec` options and re-runs
 * the Spec body on every **default** schedule fire (skips outcome_*).
 */
export function createRunSpecInvoker(
  options: Omit<RunSpecOptions, "hitl"> & {
    hitl?: RunSpecOptions["hitl"];
  }
): ScheduleInvoker {
  return createSpecScheduleInvoker(async (_ctx, entrypoint) => {
    if (isOutcomeScheduleId(entrypoint)) return;
    if (entrypoint !== DEFAULT_ENTRYPOINT && entrypoint !== "") return;
    await runSpec({
      ...options,
      // Scheduled ticks: auto-approve only when caller opted in (fixture).
      hitl: options.hitl ?? { autoApprove: options.mode === "fixture" },
    });
  });
}

export type HostScheduleInvokerOptions = Omit<RunSpecOptions, "hitl"> & {
  hitl?: RunSpecOptions["hitl"];
  /** Required to process outcome_* follow-ups. */
  runStateStore: RunStateStore;
  measureOutcome?: MeasureOutcomeFn;
  rememberOutcome?: OutcomeMemoryWriter;
};

/**
 * Scheduler invoker: default entrypoint → {@link runSpec}; `outcome_*` →
 * measure due follow-ups on the run store.
 */
export function createHostScheduleInvoker(
  options: HostScheduleInvokerOptions
): ScheduleInvoker {
  const { runStateStore, measureOutcome, rememberOutcome, ...runOpts } =
    options;
  return createSpecScheduleInvoker(async (_ctx, entrypoint) => {
    if (isOutcomeScheduleId(entrypoint)) {
      await processDueOutcomeFollowUps(runStateStore, {
        entrypointOrRuleId: entrypoint,
        measure: measureOutcome,
        remember: rememberOutcome,
      });
      return;
    }
    if (entrypoint !== DEFAULT_ENTRYPOINT && entrypoint !== "") return;
    await runSpec({
      ...runOpts,
      hitl: {
        ...(runOpts.hitl ?? { autoApprove: runOpts.mode === "fixture" }),
        runStateStore: runOpts.hitl?.runStateStore ?? runStateStore,
      },
    });
  });
}

export type ArmSpecSchedulerOptions = Omit<
  SchedulerHostOptions,
  "schedules" | "invoke"
> & {
  body: SpecV2Body;
  invoke: ScheduleInvoker;
  /** Manifest name override for the lowered workflow. */
  name?: string;
};

export type EnableSpecSchedulerOptions = ArmSpecSchedulerOptions & {
  /** Run store consulted for human-approved shadow evidence. */
  runStateStore: RunStateStore;
  /** Prefer a specific approved shadow run. */
  approvedRunId?: string;
  /**
   * When false, skip the shadow gate (tests only). Default true —
   * enabling a schedule requires ≥1 approved shadow evidence pack.
   */
  requireShadowApproval?: boolean;
};

/**
 * Lower Spec → manifest schedules and return an armed-ready {@link SchedulerHost}.
 * Fails closed when the Spec has no schedule/poll trigger (nothing to arm).
 * Does not enforce the shadow gate — use {@link enableSpecScheduler} for enable paths.
 */
export function schedulerHostFromSpec(
  options: ArmSpecSchedulerOptions
): SchedulerHost {
  const lowered = lowerSpecV2(options.body, { name: options.name });
  assertSchedulesValid(lowered.manifest);
  const schedules = listEnabledSchedules(lowered.manifest);
  if (!schedules.length) {
    throw new SpecHostError(
      "no_spec_schedule",
      "Spec has no schedule/poll trigger or outcome follow-up to arm"
    );
  }
  const { body: _body, name: _name, invoke, ...hostOpts } = options;
  return new SchedulerHost({
    ...hostOpts,
    schedules,
    invoke,
  });
}

/**
 * Assert shadow-gate approval for this Spec hash, then arm {@link SchedulerHost}.
 * Fail closed: no schedule enable without a human-approved complete shadow run.
 */
export async function enableSpecScheduler(
  options: EnableSpecSchedulerOptions
): Promise<{
  host: SchedulerHost;
  approvedRun?: SpecRunCheckpoint;
  specHash: string;
  specId: string;
}> {
  const {
    runStateStore,
    approvedRunId,
    requireShadowApproval = true,
    ...armOpts
  } = options;
  const lowered = lowerSpecV2(armOpts.body, { name: armOpts.name });
  let approvedRun: SpecRunCheckpoint | undefined;
  if (requireShadowApproval) {
    // Gate on content hash only — Spec id may differ across freezes of the same body.
    approvedRun = await assertShadowGate({
      store: runStateStore,
      specHash: lowered.specHash,
      runId: approvedRunId,
    });
  }
  const host = schedulerHostFromSpec(armOpts);
  return {
    host,
    approvedRun,
    specHash: lowered.specHash,
    specId: lowered.relay.specId ?? lowered.specRecord?.id ?? "",
  };
}
