import type {
  ComputerActionPayload,
  ComputerEngine,
} from "@relay/engines-computer";
import {
  captureObserveObservation,
  captureScreenshotObservation,
  runSeatPolicyLoop,
} from "@relay/computer-seat-policy";
import { launchApp } from "./launch.js";
import type {
  PhoneLoopOptions,
  PhoneLoopResult,
  PhoneObserveMode,
} from "./types.js";

const sleepDefault = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function needsPhoneSettle(action: ComputerActionPayload): boolean {
  return (
    action.type === "swipe" ||
    action.type === "long_press" ||
    action.type === "launch"
  );
}

/**
 * Phone seat loop: lease kind=phone → optional launch → observe → decide → act → park.
 * No Firefox navigate / ctrl+l.
 */
export async function runPhonePolicyLoop(
  engine: ComputerEngine,
  options: PhoneLoopOptions
): Promise<PhoneLoopResult> {
  const {
    goal,
    timing,
    decide,
    maxIterations = 20,
    launchSettleMs = 2000,
    swipeSettleMs = 450,
    heartbeatEachIteration = true,
    recycle = false,
    reuseSession = false,
    sleep = sleepDefault,
    random = Math.random,
    onObservation,
  } = options;

  const goalText = goal.text?.trim();
  if (!goalText) {
    return {
      success: false,
      stoppedReason: "error",
      error: "PhoneGoal.text is required",
      steps: [],
    };
  }

  const observeMode: PhoneObserveMode = options.observeMode ?? "observe";
  const normalizedGoal = { ...goal, text: goalText };

  return runSeatPolicyLoop(engine, {
    goal: normalizedGoal,
    timing,
    decide,
    leaseKind: "phone",
    maxIterations,
    heartbeatEachIteration,
    recycle,
    reuseSession,
    jobId: options.jobId,
    agentId: options.agentId,
    ttlSec: options.ttlSec,
    sleep,
    random,
    onObservation,
    captureObservation: ({ iteration }) =>
      observeMode === "screenshot"
        ? captureScreenshotObservation(engine, iteration)
        : captureObserveObservation(engine, iteration, options.maxElements),
    beforeLoop: async () => {
      if (!normalizedGoal.package && !normalizedGoal.uri) {
        return { success: true };
      }
      const launched = await launchApp(engine, {
        package: normalizedGoal.package,
        uri: normalizedGoal.uri,
        settleMs: launchSettleMs,
        sleep,
      });
      if (!launched.success) {
        return {
          success: false,
          error: launched.error ?? "phone launch failed",
        };
      }
      return { success: true };
    },
    settleAfterAction: async (action) => {
      if (swipeSettleMs > 0 && needsPhoneSettle(action)) {
        await sleep(swipeSettleMs);
      }
    },
  });
}
