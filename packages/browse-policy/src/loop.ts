import type {
  ComputerActionPayload,
  ComputerEngine,
  ComputerObserveElement,
} from "@relay/engines-computer";
import { navigateToUrl } from "@relay/engines-computer";
import { sampleWaitMs, shouldExit } from "./timing.js";
import type {
  BrowseLoopOptions,
  BrowseLoopResult,
  BrowseObservation,
  BrowseObserveMode,
  BrowseStepRecord,
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

async function captureObservation(
  engine: ComputerEngine,
  mode: BrowseObserveMode,
  maxElements: number | undefined,
  iteration: number
): Promise<
  | { ok: true; observation: BrowseObservation }
  | { ok: false; error: string }
> {
  if (mode === "observe") {
    const obs = await engine.execute({
      type: "observe",
      params: maxElements != null ? { max_elements: maxElements } : {},
    });
    if (!obs.success) {
      return { ok: false, error: obs.error ?? "observe failed" };
    }
    const image =
      typeof obs.data?.image === "string" ? obs.data.image : "";
    if (!image) {
      return { ok: false, error: "observe returned no image" };
    }
    const elements = Array.isArray(obs.data?.elements)
      ? (obs.data.elements as ComputerObserveElement[])
      : undefined;
    return {
      ok: true,
      observation: {
        imageBase64: image,
        at: new Date().toISOString(),
        elements,
        meta: {
          iteration,
          observeMode: "observe",
          element_count: obs.data?.element_count,
          geometry: obs.data?.geometry,
        },
      },
    };
  }

  const shot = await engine.execute({ type: "screenshot", params: {} });
  if (!shot.success) {
    return { ok: false, error: shot.error ?? "screenshot failed" };
  }
  const image = typeof shot.data?.image === "string" ? shot.data.image : "";
  if (!image) {
    return { ok: false, error: "screenshot returned no image" };
  }
  return {
    ok: true,
    observation: {
      imageBase64: image,
      at: new Date().toISOString(),
      meta: { iteration, observeMode: "screenshot" },
    },
  };
}

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
  const seatKind = goal.seatKind ?? "desktop";
  const phone = seatKind === "phone";
  const observeMode: BrowseObserveMode =
    options.observeMode ?? (phone ? "observe" : "screenshot");
  const swipeSettleMs =
    options.swipeSettleMs ?? (phone ? 450 : 0);
  const normalizedGoal = { ...goal, text: goalText, seatKind };

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
          ...(phone ? { kind: "phone" as const } : {}),
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
      if (phone) {
        const nav = await openPhoneStartUrl(
          engine,
          normalizedGoal.startUrl,
          navigateSettleMs,
          sleep
        );
        if (!nav.success) {
          return {
            success: false,
            stoppedReason: "error",
            error: nav.error ?? "phone launch failed",
            steps,
            vncUrl: engine.getVncUrl() ?? undefined,
          };
        }
      } else {
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

      const captured = await captureObservation(
        engine,
        observeMode,
        options.maxElements,
        iteration
      );
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

      if (swipeSettleMs > 0 && needsPhoneSettle(decision.action)) {
        await sleep(swipeSettleMs);
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
