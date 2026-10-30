import type { SpecV2Body } from "@relay/protocol";
import {
  assertSchedulesValid,
  listEnabledSchedules,
} from "@relay/protocol";
import { lowerSpecV2 } from "@relay/spec-lower";
import {
  SchedulerHost,
  type ScheduleInvoker,
  type SchedulerHostOptions,
} from "@relay/scheduler";
import { SpecHostError } from "./errors.js";
import { runSpec } from "./run.js";
import type { RunSpecOptions, RunSpecResult } from "./types.js";

export type SpecScheduleRunFactory = (
  ctx: Parameters<ScheduleInvoker>[1]
) => Promise<RunSpecResult> | RunSpecResult;

/**
 * Build a scheduler invoker that runs a Spec via {@link runSpec}.
 * The lowered schedule entrypoint is always `default` (root stages).
 */
export function createSpecScheduleInvoker(
  factory: SpecScheduleRunFactory
): ScheduleInvoker {
  return async (_entrypoint, ctx) => {
    await factory(ctx);
  };
}

/**
 * Convenience invoker that freezes call-site `runSpec` options and re-runs
 * the Spec body on every schedule fire.
 */
export function createRunSpecInvoker(
  options: Omit<RunSpecOptions, "hitl"> & {
    hitl?: RunSpecOptions["hitl"];
  }
): ScheduleInvoker {
  return createSpecScheduleInvoker(async () =>
    runSpec({
      ...options,
      // Scheduled ticks: auto-approve only when caller opted in (fixture).
      hitl: options.hitl ?? { autoApprove: options.mode === "fixture" },
    })
  );
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

/**
 * Lower Spec → manifest schedules and return an armed-ready {@link SchedulerHost}.
 * Fails closed when the Spec has no schedule/poll trigger (nothing to arm).
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
      "Spec has no schedule/poll trigger to arm (use trigger.schedule or trigger.poll)"
    );
  }
  const { body: _body, name: _name, invoke, ...hostOpts } = options;
  return new SchedulerHost({
    ...hostOpts,
    schedules,
    invoke,
  });
}
