import type { ComputerEngine } from "@relay/engines-computer";
import { navigateToUrl } from "@relay/engines-computer";
import { sampleWaitMs, shouldExit } from "./timing.js";
import type {
  BrowseLoopOptions,
  BrowseLoopResult,
  BrowseObservation,
  BrowseStepRecord,
} from "./types.js";

const sleepDefault = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Observe → sample human-like wait → vision decide → act, until stop.
 * Caller supplies ComputerEngine + BrowseDecider; inference stays outside the gateway.
 */
export async function runBrowsePolicyLoop(
  engine: ComputerEngine,
  options: BrowseLoopOptions
): Promise<BrowseLoopResult> {
  const {
    goal,
    timing,
    decide,
    maxIterations = 20,
    navigateSettleMs = 2000,
    /** When true (default), heartbeat once per iteration to keep long leases alive. */
    heartbeatEachIteration = true,
    recycle = false,
    reuseSession = false,
    sleep = sleepDefault,
    random = Math.random,
    onObservation,
  } = options;

  const steps: BrowseStepRecord[] = [];
  const evidencePaths: string[] = [];
  const goalText = goal.text?.trim();
  if (!goalText) {
    return {
      success: false,
      stoppedReason: "error",
      error: "BrowseGoal.text is required",
      steps,
    };
  }
  const normalizedGoal = { ...goal, text: goalText };

  const hadSession = Boolean(engine.getSessionId());
  if (hadSession && !reuseSession) {
    return {
      success: false,
      stoppedReason: "error",
      error: "engine already leased; pass reuseSession: true or release first",
      steps,
      vncUrl: engine.getVncUrl() ?? undefined,
    };
  }

  let leasedThisRun = false;
  try {
    if (!hadSession) {
      const lease = await engine.execute({
        type: "lease",
        params: {
          job_id: options.jobId,
          agent_id: options.agentId,
          ttl_sec: options.ttlSec,
        },
      });
      if (!lease.success) {
        return {
          success: false,
          stoppedReason: "error",
          error: lease.error ?? "lease failed",
          steps,
        };
      }
      leasedThisRun = true;
    }

    if (normalizedGoal.startUrl) {
      const nav = await navigateToUrl(
        engine,
        normalizedGoal.startUrl,
        navigateSettleMs
      );
      if (!nav.success) {
        return {
          success: false,
          stoppedReason: "error",
          error: nav.error ?? "navigate failed",
          steps,
          vncUrl: engine.getVncUrl() ?? undefined,
        };
      }
    }

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      if (heartbeatEachIteration) {
        await engine.execute({
          type: "heartbeat",
          params: { ttl_sec: options.ttlSec },
        });
      }

      const waitedMs = sampleWaitMs(timing, random);
      if (waitedMs > 0) {
        await sleep(waitedMs);
      }

      const shot = await engine.execute({ type: "screenshot", params: {} });
      if (!shot.success) {
        return {
          success: false,
          stoppedReason: "error",
          error: shot.error ?? "screenshot failed",
          steps,
          evidencePaths: evidencePaths.length ? evidencePaths : undefined,
          vncUrl: engine.getVncUrl() ?? undefined,
        };
      }

      const image =
        typeof shot.data?.image === "string" ? shot.data.image : "";
      if (!image) {
        return {
          success: false,
          stoppedReason: "error",
          error: "screenshot returned no image",
          steps,
          evidencePaths: evidencePaths.length ? evidencePaths : undefined,
          vncUrl: engine.getVncUrl() ?? undefined,
        };
      }

      const observation: BrowseObservation = {
        imageBase64: image,
        at: new Date().toISOString(),
        meta: { iteration },
      };

      if (onObservation) {
        const path = await onObservation(observation, iteration);
        if (typeof path === "string" && path.trim()) {
          evidencePaths.push(path.trim());
        }
      }

      const decision = await decide.decide({
        goal: normalizedGoal,
        observation,
        history: steps,
        iteration,
        maxIterations,
      });

      const record: BrowseStepRecord = {
        iteration,
        waitedMs,
        observationAt: observation.at,
        decision,
      };

      if (decision.kind === "done") {
        steps.push(record);
        return {
          success: true,
          stoppedReason: "done",
          steps,
          evidencePaths: evidencePaths.length ? evidencePaths : undefined,
          vncUrl: engine.getVncUrl() ?? undefined,
        };
      }

      if (decision.kind === "need_human") {
        steps.push(record);
        return {
          success: false,
          stoppedReason: "need_human",
          error: decision.reason ?? "needs human",
          steps,
          evidencePaths: evidencePaths.length ? evidencePaths : undefined,
          vncUrl: engine.getVncUrl() ?? undefined,
        };
      }

      if (!decision.action?.type) {
        record.actionOk = false;
        record.actionError = 'decision kind "act" missing action';
        steps.push(record);
        return {
          success: false,
          stoppedReason: "error",
          error: record.actionError,
          steps,
          evidencePaths: evidencePaths.length ? evidencePaths : undefined,
          vncUrl: engine.getVncUrl() ?? undefined,
        };
      }

      const allowed = normalizedGoal.allowedActions;
      if (
        allowed &&
        allowed.length > 0 &&
        !allowed.includes(decision.action.type)
      ) {
        record.actionOk = false;
        record.actionError = `action type "${decision.action.type}" not in allowedActions`;
        steps.push(record);
        return {
          success: false,
          stoppedReason: "error",
          error: record.actionError,
          steps,
          evidencePaths: evidencePaths.length ? evidencePaths : undefined,
          vncUrl: engine.getVncUrl() ?? undefined,
        };
      }

      const acted = await engine.execute({
        type: "action",
        params: { action: decision.action },
      });
      record.actionOk = acted.success;
      if (!acted.success) {
        record.actionError = acted.error ?? "action failed";
        steps.push(record);
        return {
          success: false,
          stoppedReason: "error",
          error: record.actionError,
          steps,
          evidencePaths: evidencePaths.length ? evidencePaths : undefined,
          vncUrl: engine.getVncUrl() ?? undefined,
        };
      }
      steps.push(record);

      if (shouldExit(timing.exitRateMu, random)) {
        return {
          success: true,
          stoppedReason: "exit_hazard",
          steps,
          evidencePaths: evidencePaths.length ? evidencePaths : undefined,
          vncUrl: engine.getVncUrl() ?? undefined,
        };
      }
    }

    return {
      success: false,
      stoppedReason: "max_iterations",
      error: `reached maxIterations (${maxIterations}) without done`,
      steps,
      evidencePaths: evidencePaths.length ? evidencePaths : undefined,
      vncUrl: engine.getVncUrl() ?? undefined,
    };
  } finally {
    if (leasedThisRun && engine.getSessionId()) {
      if (recycle) {
        await engine.execute({ type: "recycle", params: {} });
      } else {
        await engine.execute({ type: "release", params: {} });
      }
    }
  }
}
