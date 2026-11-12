import type {
  AgentContext,
  ExecutionEngine,
  FeedbackContext,
  FeedbackPoint,
  FeedbackResponse,
  StageDefinition,
} from "@relay/protocol";
import { isAbortResponse, parseCapabilityUse } from "@relay/protocol";
import type { AppController } from "@relay/runtime";
import {
  SPEC_V2_BROWSE_NEED_HUMAN_PREFIX,
  type LoweredWorkflow,
} from "@relay/spec-lower";
import {
  buildRefScope,
  recordEvidence,
  resolveRefs,
  type WorkflowStepsBag,
} from "@relay/workflow-runtime";
import { ComputerEngine } from "@relay/engines-computer";
import { runBrowsePolicyLoop } from "./loop.js";
import { defaultBrowseTiming } from "./timing.js";
import type {
  BrowseActionMixPriors,
  BrowseDecider,
  BrowseTimingConfig,
  BrowseWaitDistribution,
} from "./types.js";

export interface BrowsePolicyControllerOptions {
  lowered: LoweredWorkflow;
  getContext: () => AgentContext;
  decide: BrowseDecider;
  /** Defaults merged with per-step args (lambda, mu, …). */
  timing?: BrowseTimingConfig;
  /** Prefer engines.computer when set; else require ComputerEngine as stage engine. */
  engines?: Record<string, ExecutionEngine>;
}

function isBrowseStep(use: string): boolean {
  const parsed = parseCapabilityUse(use);
  return (
    parsed.ok &&
    parsed.capability.engine === "computer" &&
    parsed.capability.verb === "browse"
  );
}

function asComputerEngine(engine?: ExecutionEngine): ComputerEngine | null {
  if (!engine) return null;
  if (engine instanceof ComputerEngine) return engine;
  if (
    engine.type === "computer" &&
    typeof (engine as ComputerEngine).execute === "function" &&
    typeof (engine as ComputerEngine).getSessionId === "function"
  ) {
    return engine as ComputerEngine;
  }
  return null;
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
 * AppController for Spec steps with `use: "computer.browse"`.
 * Other stages are ignored — pair with {@link withBrowsePolicy}.
 */
export class BrowsePolicyController implements AppController {
  private readonly lowered: LoweredWorkflow;
  private readonly getContext: () => AgentContext;
  private readonly decide: BrowseDecider;
  private readonly baseTiming: BrowseTimingConfig;
  private readonly engines: Record<string, ExecutionEngine>;

  constructor(options: BrowsePolicyControllerOptions) {
    this.lowered = options.lowered;
    this.getContext = options.getContext;
    this.decide = options.decide;
    this.baseTiming = options.timing ?? defaultBrowseTiming();
    this.engines = options.engines ?? {};
  }

  handles(stage: StageDefinition): boolean {
    const step = this.lowered.relay.steps.find((s) => s.id === stage.name);
    return Boolean(step && isBrowseStep(step.use));
  }

  async onStageStart(
    stage: StageDefinition,
    engine?: ExecutionEngine
  ): Promise<void> {
    if (!this.handles(stage)) return;

    const ctx = this.getContext();
    const step = this.lowered.relay.steps.find((s) => s.id === stage.name);
    if (!step) {
      throw new Error(
        `BrowsePolicyController: no Spec step for stage ${JSON.stringify(stage.name)}`
      );
    }

    const computer =
      asComputerEngine(this.engines.computer) ?? asComputerEngine(engine);
    if (!computer) {
      throw new Error(
        `BrowsePolicyController: stage ${JSON.stringify(stage.name)} requires a ComputerEngine`
      );
    }

    const scope = buildRefScope(ctx, this.lowered.relay);
    const args = (resolveRefs(step.args ?? {}, scope) ?? {}) as Record<
      string,
      unknown
    >;
    const goalText = str(args.goal);
    if (!goalText) {
      throw new Error(
        `BrowsePolicyController: step ${JSON.stringify(step.id)} requires args.goal`
      );
    }

    const url = str(args.url) ?? str(args.startUrl);
    const lambda = num(args.lambda) ?? num(args.actionRateLambda);
    const mu = num(args.mu) ?? num(args.exitRateMu);
    const maxSteps = num(args.maxSteps) ?? 20;
    const distRaw = str(args.distribution);
    const distribution: BrowseWaitDistribution | undefined =
      distRaw === "lognormal" || distRaw === "exponential"
        ? distRaw
        : undefined;

    const timing: BrowseTimingConfig = {
      ...this.baseTiming,
      ...(lambda !== undefined ? { actionRateLambda: lambda } : {}),
      ...(mu !== undefined ? { exitRateMu: mu } : {}),
      ...(distribution ? { distribution } : {}),
    };

    const actionMix =
      args.actionMix && typeof args.actionMix === "object"
        ? (args.actionMix as BrowseActionMixPriors)
        : undefined;
    const allowedActions = Array.isArray(args.allowedActions)
      ? args.allowedActions.filter((a): a is string => typeof a === "string")
      : undefined;
    const seatKindRaw = str(args.seatKind) ?? str(args.kind);
    if (seatKindRaw === "phone") {
      throw new Error(
        'computer.browse no longer supports seatKind/kind "phone"; use @relay/phone-policy'
      );
    }

    const result = await runBrowsePolicyLoop(computer, {
      goal: {
        text: goalText,
        startUrl: url,
        actionMix,
        allowedActions,
      },
      timing,
      decide: this.decide,
      maxIterations: maxSteps,
      reuseSession: Boolean(computer.getSessionId()),
    });

    if (result.stoppedReason === "need_human") {
      this.writeStepOutput(ctx, step.id, {
        pending: true,
        needHuman: true,
        reason: result.error ?? "need_human",
        steps: result.steps,
        vncUrl: result.vncUrl,
      });
      ctx.feedbackContext = {
        subjectId: step.id,
        title: step.id,
        body: result.error ?? "Browse policy needs human input",
        url: result.vncUrl,
        meta: { stoppedReason: result.stoppedReason, steps: result.steps },
      } satisfies FeedbackContext;
      recordEvidence(ctx, {
        stepId: step.id,
        kind: "hitl",
        detail: {
          use: step.use,
          needHuman: true,
          reason: result.error,
        },
      });
      return;
    }

    if (!result.success) {
      recordEvidence(ctx, {
        stepId: step.id,
        kind: "error",
        detail: {
          use: step.use,
          error: result.error ?? result.stoppedReason,
          stoppedReason: result.stoppedReason,
        },
      });
      throw new Error(
        `BrowsePolicyController: step ${JSON.stringify(step.id)} failed: ${
          result.error ?? result.stoppedReason
        }`
      );
    }

    const output = {
      stoppedReason: result.stoppedReason,
      steps: result.steps,
      vncUrl: result.vncUrl,
      evidencePaths: result.evidencePaths,
    };
    this.writeStepOutput(ctx, step.id, output);
    recordEvidence(ctx, {
      stepId: step.id,
      kind: "execute",
      detail: {
        use: step.use,
        success: true,
        stoppedReason: result.stoppedReason,
        stepCount: result.steps.length,
      },
    });
  }

  async shouldSkipFeedbackPoint(
    stage: StageDefinition,
    fp: FeedbackPoint,
    context: AgentContext
  ): Promise<boolean> {
    if (!fp.description.startsWith(SPEC_V2_BROWSE_NEED_HUMAN_PREFIX)) {
      return false;
    }
    if (!this.handles(stage)) return true;
    const bag = (context.steps as WorkflowStepsBag | undefined)?.[stage.name]
      ?.output as { needHuman?: boolean; pending?: boolean } | undefined;
    return !(bag?.needHuman === true && bag?.pending === true);
  }

  async onFeedbackApplied(
    stage: StageDefinition,
    feedback: FeedbackResponse,
    _engine?: ExecutionEngine
  ): Promise<void | boolean> {
    if (!this.handles(stage)) return;

    const ctx = this.getContext();
    const step = this.lowered.relay.steps.find((s) => s.id === stage.name);
    if (!step) return;

    const prior = (ctx.steps as WorkflowStepsBag | undefined)?.[step.id]
      ?.output as
      | {
          needHuman?: boolean;
          pending?: boolean;
          reason?: string;
          steps?: unknown;
          vncUrl?: string;
        }
      | undefined;

    if (!(prior?.needHuman && prior.pending)) return;

    if (isAbortResponse(feedback)) {
      this.writeStepOutput(ctx, step.id, {
        aborted: true,
        needHuman: true,
        reason: prior.reason,
        steps: prior.steps,
        feedback,
      });
      recordEvidence(ctx, {
        stepId: step.id,
        kind: "hitl",
        detail: { needHuman: true, aborted: true },
      });
      return; // hard abort
    }

    this.writeStepOutput(ctx, step.id, {
      needHuman: true,
      resolved: true,
      reason: prior.reason,
      steps: prior.steps,
      vncUrl: prior.vncUrl,
      feedback,
    });
    recordEvidence(ctx, {
      stepId: step.id,
      kind: "hitl",
      detail: { needHuman: true, resolved: true },
    });
  }

  async buildFeedbackContext(
    stage: StageDefinition,
    _fp: FeedbackPoint,
    context: AgentContext
  ): Promise<FeedbackContext | undefined> {
    if (!this.handles(stage)) return undefined;
    if (context.feedbackContext) return context.feedbackContext;
    return undefined;
  }

  private writeStepOutput(
    ctx: AgentContext,
    stepId: string,
    output: unknown,
    feedback?: FeedbackResponse
  ): void {
    if (!ctx.steps || typeof ctx.steps !== "object") {
      ctx.steps = {} as WorkflowStepsBag;
    }
    const steps = ctx.steps as WorkflowStepsBag;
    steps[stepId] = { output, ...(feedback ? { feedback } : {}) };

    if (!ctx.stageResults) ctx.stageResults = {};
    const prev = ctx.stageResults[stepId];
    if (prev !== null && typeof prev === "object" && !Array.isArray(prev)) {
      ctx.stageResults[stepId] = {
        ...(prev as Record<string, unknown>),
        output,
        ...(feedback ? { feedback } : {}),
      };
    } else {
      ctx.stageResults[stepId] = {
        output,
        ...(feedback ? { feedback } : {}),
      };
    }
  }
}

/**
 * Route `computer.browse` stages to BrowsePolicyController; everything else
 * to the base AppController (typically WorkflowController).
 */
export function withBrowsePolicy(
  base: AppController,
  options: BrowsePolicyControllerOptions
): AppController {
  const browse = new BrowsePolicyController(options);

  return {
    async onStageStart(stage, engine) {
      if (browse.handles(stage)) {
        await browse.onStageStart(stage, engine);
        return;
      }
      await base.onStageStart?.(stage, engine);
    },

    async onFeedbackApplied(stage, feedback, engine) {
      if (browse.handles(stage)) {
        return browse.onFeedbackApplied?.(stage, feedback, engine);
      }
      return base.onFeedbackApplied?.(stage, feedback, engine);
    },

    async shouldSkipFeedbackPoint(stage, fp, context) {
      if (
        fp.description.startsWith(SPEC_V2_BROWSE_NEED_HUMAN_PREFIX) ||
        browse.handles(stage)
      ) {
        return (
          (await browse.shouldSkipFeedbackPoint?.(stage, fp, context)) ?? false
        );
      }
      return (
        (await base.shouldSkipFeedbackPoint?.(stage, fp, context)) ?? false
      );
    },

    async buildFeedbackContext(stage, fp, context) {
      if (browse.handles(stage)) {
        return browse.buildFeedbackContext?.(stage, fp, context);
      }
      return base.buildFeedbackContext?.(stage, fp, context);
    },

    async buildFeedbackPrompt(stage, fp, context) {
      return base.buildFeedbackPrompt?.(stage, fp, context);
    },

    async buildFeedbackOptions(stage, fp, context) {
      return base.buildFeedbackOptions?.(stage, fp, context);
    },
  };
}
