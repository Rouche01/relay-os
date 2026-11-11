import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ComputerSeatKind,
  ComputerTask,
  ComputerTaskContext,
  ComputerTaskResult,
} from "@relay/engines-computer";
import { runBrowsePolicyLoop } from "./loop.js";
import { defaultBrowseTiming } from "./timing.js";
import type {
  BrowseActionMixPriors,
  BrowseDecider,
  BrowseObserveMode,
  BrowseTimingConfig,
  BrowseWaitDistribution,
} from "./types.js";

export interface BrowseGoalTaskOptions {
  decide: BrowseDecider;
  timing?: BrowseTimingConfig;
  /** Default max steps when params.maxSteps omitted. */
  defaultMaxSteps?: number;
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/**
 * ComputerTask `browse_goal`: lease → policy loop → park.
 * Register on a ComputerTaskRunner; pass `decide` from createLlmBrowseDecider.
 */
export function browseGoalTask(options: BrowseGoalTaskOptions): ComputerTask {
  const baseTiming = options.timing ?? defaultBrowseTiming();
  const defaultMaxSteps = options.defaultMaxSteps ?? 20;

  return {
    id: "browse_goal",
    async run(ctx: ComputerTaskContext): Promise<ComputerTaskResult> {
      const goalText = str(ctx.params.goal);
      if (!goalText) {
        return { success: false, error: "browse_goal requires params.goal" };
      }

      const url = str(ctx.params.url) ?? str(ctx.params.startUrl);
      const lambda = num(ctx.params.lambda) ?? num(ctx.params.actionRateLambda);
      const mu = num(ctx.params.mu) ?? num(ctx.params.exitRateMu);
      const maxSteps = num(ctx.params.maxSteps) ?? defaultMaxSteps;
      const minMs = num(ctx.params.minMs);
      const maxMs = num(ctx.params.maxMs);
      const distRaw = str(ctx.params.distribution);
      const distribution: BrowseWaitDistribution | undefined =
        distRaw === "lognormal" || distRaw === "exponential"
          ? distRaw
          : undefined;

      let actionMix: BrowseActionMixPriors | undefined;
      if (ctx.params.actionMix && typeof ctx.params.actionMix === "object") {
        actionMix = ctx.params.actionMix as BrowseActionMixPriors;
      }

      const seatKindRaw = str(ctx.params.seatKind) ?? str(ctx.params.kind);
      const seatKind: ComputerSeatKind | undefined =
        seatKindRaw === "phone" || seatKindRaw === "desktop"
          ? seatKindRaw
          : undefined;
      const observeModeRaw = str(ctx.params.observeMode);
      const observeMode: BrowseObserveMode | undefined =
        observeModeRaw === "observe" || observeModeRaw === "screenshot"
          ? observeModeRaw
          : undefined;
      const swipeSettleMs = num(ctx.params.swipeSettleMs);
      const maxElements = num(ctx.params.maxElements);

      const timing: BrowseTimingConfig = {
        ...baseTiming,
        ...(lambda !== undefined ? { actionRateLambda: lambda } : {}),
        ...(mu !== undefined ? { exitRateMu: mu } : {}),
        ...(minMs !== undefined ? { minMs } : {}),
        ...(maxMs !== undefined ? { maxMs } : {}),
        ...(distribution ? { distribution } : {}),
      };

      await mkdir(ctx.session.evidenceDir, { recursive: true });

      const wantRecycle = ctx.params.recycle === true;

      const result = await runBrowsePolicyLoop(ctx.engine, {
        goal: {
          text: goalText,
          startUrl: url,
          actionMix,
          seatKind,
          allowedActions: Array.isArray(ctx.params.allowedActions)
            ? (ctx.params.allowedActions as unknown[]).filter(
                (a): a is string => typeof a === "string"
              )
            : undefined,
        },
        timing,
        decide: options.decide,
        maxIterations: maxSteps,
        observeMode,
        ...(swipeSettleMs !== undefined ? { swipeSettleMs } : {}),
        ...(maxElements !== undefined ? { maxElements } : {}),
        reuseSession: true, // runner already leased
        jobId: ctx.session.jobId,
        agentId: ctx.session.agentId,
        recycle: false, // runner owns release; we recycle explicitly below
        onObservation: async (observation, iteration) => {
          const file = path.join(
            ctx.session.evidenceDir,
            `browse_goal_${iteration}.png`
          );
          const b64 = observation.imageBase64.includes(",")
            ? observation.imageBase64.split(",").pop()!
            : observation.imageBase64;
          await writeFile(file, Buffer.from(b64, "base64"));
          return file;
        },
      });

      if (wantRecycle && ctx.engine.getSessionId()) {
        await ctx.engine.execute({ type: "recycle", params: {} });
      }

      const logPath = path.join(ctx.session.evidenceDir, "browse_goal_log.json");
      await writeFile(
        logPath,
        JSON.stringify(
          {
            goal: goalText,
            url,
            seatKind: seatKind ?? "desktop",
            observeMode:
              observeMode ?? (seatKind === "phone" ? "observe" : "screenshot"),
            timing,
            stoppedReason: result.stoppedReason,
            steps: result.steps,
          },
          null,
          2
        ),
        "utf8"
      );

      const evidencePaths = [
        ...(result.evidencePaths ?? []),
        logPath,
      ];

      if (!result.success && result.stoppedReason !== "need_human") {
        return {
          success: false,
          error: result.error ?? result.stoppedReason,
          evidencePaths,
          vncUrl: result.vncUrl,
          meta: {
            stoppedReason: result.stoppedReason,
            steps: result.steps.length,
          },
        };
      }

      return {
        success:
          result.stoppedReason === "done" ||
          result.stoppedReason === "exit_hazard",
        error:
          result.stoppedReason === "need_human"
            ? result.error ?? "need_human"
            : undefined,
        evidencePaths,
        vncUrl: result.vncUrl,
        meta: {
          stoppedReason: result.stoppedReason,
          steps: result.steps.length,
        },
      };
    },
  };
}
