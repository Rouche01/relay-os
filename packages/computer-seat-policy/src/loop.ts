import type {
  ComputerActionPayload,
  ComputerEngine,
} from "@relay/engines-computer";
import { sampleWaitMs, shouldExit } from "./timing.js";
import type {
  SeatGoalBase,
  SeatLoopOptions,
  SeatLoopResult,
  SeatStepRecord,
} from "./types.js";

const sleepDefault = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Lease → optional beforeLoop → (wait → observe → decide → act)* → park.
 * Policy packs supply capture / beforeLoop / settle / prompts via options.
 */
export async function runSeatPolicyLoop<G extends SeatGoalBase>(
  engine: ComputerEngine,
  options: SeatLoopOptions<G>
): Promise<SeatLoopResult> {
  const {
    goal,
    timing,
    decide,
    captureObservation,
    beforeLoop,
    settleAfterAction,
    leaseKind,
    maxIterations = 20,
    heartbeatEachIteration = true,
    recycle = false,
    reuseSession = false,
    sleep = sleepDefault,
    random = Math.random,
    onObservation,
  } = options;

  const steps: SeatStepRecord[] = [];
  const evidencePaths: string[] = [];
  const goalText = goal.text?.trim();
  if (!goalText) {
    return {
      success: false,
      stoppedReason: "error",
      error: "goal.text is required",
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
          ...(leaseKind ? { kind: leaseKind } : {}),
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

    if (beforeLoop) {
      const prep = await beforeLoop();
      if (!prep.success) {
        return {
          success: false,
          stoppedReason: "error",
          error: prep.error ?? "beforeLoop failed",
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

      const captured = await captureObservation({ iteration });
      if (!captured.ok) {
        return {
          success: false,
          stoppedReason: "error",
          error: captured.error,
          steps,
          evidencePaths: evidencePaths.length ? evidencePaths : undefined,
          vncUrl: engine.getVncUrl() ?? undefined,
        };
      }
      const observation = captured.observation;

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

      const record: SeatStepRecord = {
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

      if (settleAfterAction) {
        await settleAfterAction(decision.action as ComputerActionPayload);
      }

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
