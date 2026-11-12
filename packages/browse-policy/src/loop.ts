import type {
  ComputerActionPayload,
  ComputerEngine,
} from "@relay/engines-computer";
import { navigateToUrl } from "@relay/engines-computer";
import {
  captureObserveObservation,
  captureScreenshotObservation,
  runSeatPolicyLoop,
} from "@relay/computer-seat-policy";
import type {
  BrowseLoopOptions,
  BrowseLoopResult,
  BrowseObserveMode,
} from "./types.js";

const sleepDefault = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function needsPhoneSettle(action: ComputerActionPayload): boolean {
  return (
    action.type === "swipe" ||
    action.type === "long_press" ||
    action.type === "launch"
  );
}

async function openPhoneStartUrl(
  engine: ComputerEngine,
  url: string,
  settleMs: number,
  sleep: (ms: number) => Promise<void>
): Promise<{ success: boolean; error?: string }> {
  const trimmed = url.trim();
  if (!trimmed) {
    return { success: false, error: "startUrl is empty" };
  }
  const launched = await engine.execute({
    type: "action",
    params: { action: { type: "launch", uri: trimmed } },
  });
  if (!launched.success) {
    return {
      success: false,
      error: launched.error ?? "phone launch(uri) failed",
    };
  }
  if (settleMs > 0) {
    await sleep(settleMs);
  }
  return { success: true };
}

/**
 * Observe → sample human-like wait → vision decide → act, until stop.
 * Caller supplies ComputerEngine + BrowseDecider; inference stays outside the gateway.
 *
 * Implementation delegates to `@relay/computer-seat-policy` with browse/phone adapters.
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

  const seatKind = goal.seatKind ?? "desktop";
  const phone = seatKind === "phone";
  const observeMode: BrowseObserveMode =
    options.observeMode ?? (phone ? "observe" : "screenshot");
  const swipeSettleMs = options.swipeSettleMs ?? (phone ? 450 : 0);
  const normalizedGoal = { ...goal, text: goalText, seatKind };

  return runSeatPolicyLoop(engine, {
    goal: normalizedGoal,
    timing,
    decide,
    leaseKind: phone ? "phone" : undefined,
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
      observeMode === "observe"
        ? captureObserveObservation(engine, iteration, options.maxElements)
        : captureScreenshotObservation(engine, iteration),
    beforeLoop: async () => {
      if (!normalizedGoal.startUrl) {
        return { success: true };
      }
      if (phone) {
        return openPhoneStartUrl(
          engine,
          normalizedGoal.startUrl,
          navigateSettleMs,
          sleep
        );
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
    settleAfterAction: async (action) => {
      if (swipeSettleMs > 0 && needsPhoneSettle(action)) {
        await sleep(swipeSettleMs);
      }
    },
  });
}
