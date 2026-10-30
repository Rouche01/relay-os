import { SpecHostError } from "./errors.js";
import { runSpec } from "./run.js";
import type { RunSpecOptions, RunSpecResult } from "./types.js";
import type { SpecRunCheckpoint, RunStateStore } from "./checkpoint.js";

export type ReplaySpecOptions = Omit<RunSpecOptions, "body" | "frozen"> & {
  checkpoint?: SpecRunCheckpoint;
  runId?: string;
  runStateStore?: RunStateStore;
  /**
   * New run id for the replay (default: generated).
   * Does not overwrite the source run unless `runId` equals the source.
   */
  asRunId?: string;
};

/**
 * Re-run a Spec from a stored run's frozen Spec + body.
 * Defaults to fixture-friendly options from the caller; does not copy HITL state.
 */
export async function replaySpecRun(
  options: ReplaySpecOptions
): Promise<RunSpecResult> {
  let checkpoint = options.checkpoint;
  if (!checkpoint) {
    const store = options.runStateStore ?? options.hitl?.runStateStore;
    if (!options.runId || !store) {
      throw new SpecHostError(
        "missing_checkpoint",
        "replaySpecRun requires checkpoint or runId + runStateStore"
      );
    }
    checkpoint = await Promise.resolve(store.get(options.runId));
    if (!checkpoint) {
      throw new SpecHostError(
        "checkpoint_not_found",
        `No run ${JSON.stringify(options.runId)} to replay`
      );
    }
  }

  const hitl = {
    ...(options.hitl ?? {}),
    runId: options.asRunId ?? options.hitl?.runId,
    runStateStore:
      options.hitl?.runStateStore ?? options.runStateStore ?? undefined,
  };

  return runSpec({
    ...options,
    frozen: checkpoint.frozen,
    body: checkpoint.body,
    mode: options.mode ?? "fixture",
    hitl,
  });
}
