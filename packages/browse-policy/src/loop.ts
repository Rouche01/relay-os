import type { ComputerEngine } from "@relay/engines-computer";
import { navigateToUrl } from "@relay/engines-computer";
import {
  captureScreenshotObservation,
  runSeatPolicyLoop,
} from "@relay/computer-seat-policy";
import type { BrowseLoopOptions, BrowseLoopResult } from "./types.js";

const sleepDefault = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Screenshot → sample human-like wait → vision decide → act, until stop.
 * Desktop Firefox desks only. Phone automation: `@relay/phone-policy`.
 *
 * Implementation delegates to `@relay/computer-seat-policy`.
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
      error: "BrowseGoal.text is required",
      steps: [],
    };
  }

  const normalizedGoal = { ...goal, text: goalText };

  return runSeatPolicyLoop(engine, {
    goal: normalizedGoal,
    timing,
    decide,
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
      captureScreenshotObservation(engine, iteration),
    beforeLoop: async () => {
      if (!normalizedGoal.startUrl) {
        return { success: true };
      }
      const nav = await navigateToUrl(
        engine,
        normalizedGoal.startUrl,
        navigateSettleMs
      );
      if (!nav.success) {
        return {
          success: false,
          error: nav.error ?? "navigate failed",
        };
      }
      return { success: true };
    },
  });
}
