import type {
  AgentContext,
  ExecutionEngine,
  FeedbackContext,
  FeedbackPoint,
  FeedbackResponse,
  StageDefinition,
} from "@relay/protocol";
import {
  isAbortResponse,
  isEditResponse,
  parseCapabilityUse,
  SPEC_V2_ESCALATE_FEEDBACK_PREFIX,
} from "@relay/protocol";
import {
  foreachContextKey,
  type LoweredWorkflow,
} from "@relay/spec-lower";
import type { AppController } from "@relay/runtime";
import { EnforceError, enforceRules } from "./enforce.js";
import { recordEvidence } from "./evidence.js";
import {
  commitOnce,
  isDryRunSimulated,
  lookupOnce,
  onceStorageKey,
  stringifyOnceKey,
} from "./once.js";
import { buildRefScope, lookupRef, resolveRefs } from "./refs.js";
import {
  backoffMsForAttempt,
  resolveAttemptBudget,
  resolveOnError,
  sleep,
} from "./retry.js";
import type {
  WorkflowControllerOptions,
  WorkflowStepsBag,
} from "./types.js";
import { evaluateWhen } from "./when.js";

/**
 * Generic AppController that interprets lowered Spec v2 steps on AgentRuntime.
 *
 * - Resolves `${...}` args against prior step outputs / item / budget
 * - Calls `engine.execute` with capability verb
 * - Enforces hard (and soft when llm available) rules fail-closed
 * - Records an evidence trail on context.evidence
 * - HITL via existing feedback_points (human.* stages)
 */
export class WorkflowController implements AppController {
  private readonly lowered: LoweredWorkflow;
  private readonly getContext: () => AgentContext;
  private readonly engines: Record<string, ExecutionEngine>;
  private readonly softFailClosed: boolean;

  constructor(options: WorkflowControllerOptions) {
    this.lowered = options.lowered;
    this.getContext = options.getContext;
    this.engines = options.engines ?? {};
    this.softFailClosed = options.softFailClosed ?? true;
  }

  async onStageStart(
    stage: StageDefinition,
    engine?: ExecutionEngine
  ): Promise<void> {
    const ctx = this.getContext();
    const step = this.lowered.relay.steps.find((s) => s.id === stage.name);
    if (!step) {
      throw new Error(
        `WorkflowController: no Spec step for stage ${JSON.stringify(stage.name)}`
      );
    }

    const scope = buildRefScope(ctx, this.lowered.relay);

    // Fanout parent: populate the foreach array, then AgentRuntime expands.
    if (stage.fanout) {
      const refPath = this.lowered.relay.foreachFrom[step.id];
      if (!refPath) {
        throw new Error(
          `WorkflowController: missing foreachFrom for ${JSON.stringify(step.id)}`
        );
      }
      const list = lookupRef(refPath, scope);
      if (!Array.isArray(list)) {
        throw new Error(
          `WorkflowController: forEach ${JSON.stringify(step.forEach)} did not resolve to an array (got ${typeof list})`
        );
      }
      const key = foreachContextKey(step.id);
      ctx[key] = list;
      recordEvidence(ctx, {
        stepId: step.id,
        kind: "fanout",
        detail: { from: refPath, count: list.length, contextKey: key },
      });
      return;
    }

    // Spec v2.1 when — skip before HITL / once / execute (per fanout child).
    if (step.when !== undefined) {
      const gate = evaluateWhen(step.when, scope);
      if (!gate.ok) {
        const skipped = {
          skipped: true,
          reason: "when" as const,
          when: step.when,
          detail: gate.detail,
        };
        this.writeStepOutput(ctx, step.id, skipped);
        recordEvidence(ctx, {
          stepId: step.id,
          kind: "skip",
          detail: { reason: "when", ...gate.detail },
        });
        return;
      }
    }

    const parsed = parseCapabilityUse(step.use);
    if (!parsed.ok) {
      throw new Error(`WorkflowController: ${parsed.error}`);
    }

    // HITL: prepare show payload; feedback_points block in AgentRuntime.
    if (parsed.capability.engine === "human") {
      const args = (resolveRefs(step.args ?? {}, scope) ?? {}) as Record<
        string,
        unknown
      >;
      const show = args.show;
      this.writeStepOutput(ctx, step.id, {
        pending: true,
        show,
        prompt: args.prompt,
        options: args.options,
      });
      ctx.feedbackContext = showToFeedbackContext(show, step.id);
      recordEvidence(ctx, {
        stepId: step.id,
        kind: "hitl",
        detail: { verb: parsed.capability.verb, pending: true },
      });
      return;
    }

    if (!engine) {
      throw new Error(
        `WorkflowController: stage ${JSON.stringify(stage.name)} requires engine ${JSON.stringify(parsed.capability.engine)}`
      );
    }

    const dataEngine = this.engines.data;
    let onceKey: string | undefined;
    let onceStorage: string | undefined;
    if (step.once) {
      if (!dataEngine) {
        throw new Error(
          `Step ${JSON.stringify(step.id)} declares once but no data engine is wired`
        );
      }
      const resolved = resolveRefs(step.once, scope);
      const keyStr = stringifyOnceKey(resolved);
      if (!keyStr) {
        throw new Error(
          `Step ${JSON.stringify(step.id)} once ${JSON.stringify(step.once)} resolved to empty`
        );
      }
      onceKey = keyStr;
      onceStorage = onceStorageKey(
        this.lowered.specHash,
        step.id,
        resolved
      );
      const prior = await lookupOnce(dataEngine, onceStorage);
      if (prior) {
        const skipped = {
          skipped: true,
          reason: "once" as const,
          onceKey,
          prior,
        };
        this.writeStepOutput(ctx, step.id, skipped);
        recordEvidence(ctx, {
          stepId: step.id,
          kind: "skip",
          detail: {
            reason: "once",
            onceKey,
            storageKey: onceStorage,
            prior,
          },
        });
        return;
      }
    }

    const args = (resolveRefs(step.args ?? {}, scope) ?? {}) as Record<
      string,
      unknown
    >;
    const actionType = parsed.capability.verb;
    const attempts = resolveAttemptBudget(step.retry);
    const onError = resolveOnError(step.onError);
    let lastError = "execute_failed";
    let output: unknown;
    let succeeded = false;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) {
        const wait = backoffMsForAttempt(step.retry, attempt - 1);
        if (wait > 0) await sleep(wait);
      }
      const result = await engine.execute({
        type: actionType,
        params: args,
        context: ctx,
      });
      if (result.success) {
        output = result.data;
        succeeded = true;
        if (attempt > 1) {
          recordEvidence(ctx, {
            stepId: step.id,
            kind: "execute",
            detail: {
              use: step.use,
              retried: true,
              attempt,
              attempts,
              success: true,
            },
          });
        }
        break;
      }
      lastError = result.error ?? "execute_failed";
      recordEvidence(ctx, {
        stepId: step.id,
        kind: "error",
        detail: {
          error: lastError,
          use: step.use,
          attempt,
          attempts,
          willRetry: attempt < attempts,
        },
      });
    }

    if (!succeeded) {
      if (onError === "skip_item") {
        const skipped = {
          skipped: true,
          reason: "onError" as const,
          onError: "skip_item" as const,
          error: lastError,
        };
        this.writeStepOutput(ctx, step.id, skipped);
        recordEvidence(ctx, {
          stepId: step.id,
          kind: "skip",
          detail: {
            reason: "onError",
            onError: "skip_item",
            error: lastError,
            attempts,
          },
        });
        return;
      }
      if (onError === "escalate_human") {
        this.writeStepOutput(ctx, step.id, {
          pending: true,
          escalate: true,
          error: lastError,
          show: {
            title: `Step ${step.id} failed`,
            body: lastError,
            attempts,
          },
          prompt: `Step ${step.id} failed after ${attempts} attempt(s): ${lastError}. Approve to skip, Abort to fail.`,
        });
        ctx.feedbackContext = {
          subjectId: step.id,
          title: `Escalate: ${step.id}`,
          body: lastError,
        };
        recordEvidence(ctx, {
          stepId: step.id,
          kind: "hitl",
          detail: {
            escalate: true,
            onError: "escalate_human",
            error: lastError,
            attempts,
            pending: true,
          },
        });
        return;
      }
      throw new Error(
        `Step ${JSON.stringify(step.id)} (${step.use}) failed: ${lastError}`
      );
    }

    this.writeStepOutput(ctx, step.id, output);
    const detail: Record<string, unknown> = {
      use: step.use,
      success: true,
    };
    // engines-api dry-run irreversible → simulated write (shadow / fixture)
    if (isDryRunSimulated(output)) {
      detail.dryRunSimulated = true;
      detail.shadowWrite = true;
    }
    if (onceKey) {
      detail.onceKey = onceKey;
    }
    recordEvidence(ctx, {
      stepId: step.id,
      kind: "execute",
      detail,
    });

    // Commit idempotency only for non-simulated writes (live / non-dry).
    if (onceStorage && onceKey && !isDryRunSimulated(output)) {
      await commitOnce(dataEngine, onceStorage, {
        at: new Date().toISOString(),
        stepId: step.id,
        use: step.use,
        onceKey,
        committed: true,
      });
    }

    if (step.enforce?.length) {
      await this.runEnforce(ctx, step.id, step.enforce, output, engine);
    }
  }

  async shouldSkipFeedbackPoint(
    stage: StageDefinition,
    fp: FeedbackPoint,
    context: AgentContext
  ): Promise<boolean> {
    if (!fp.description.startsWith(SPEC_V2_ESCALATE_FEEDBACK_PREFIX)) {
      return false;
    }
    const bag = (context.steps as WorkflowStepsBag | undefined)?.[stage.name]
      ?.output as { escalate?: boolean; pending?: boolean } | undefined;
    // Only pause when execute left an escalate pending.
    return !(bag?.escalate === true && bag?.pending === true);
  }

  async onFeedbackApplied(
    stage: StageDefinition,
    feedback: FeedbackResponse,
    engine?: ExecutionEngine
  ): Promise<void | boolean> {
    const ctx = this.getContext();
    const step = this.lowered.relay.steps.find((s) => s.id === stage.name);
    if (!step) return;

    const priorBag = (ctx.steps as WorkflowStepsBag | undefined)?.[step.id]
      ?.output as
      | { show?: unknown; escalate?: boolean; error?: string; pending?: boolean }
      | undefined;

    if (priorBag?.escalate === true) {
      if (isAbortResponse(feedback)) {
        this.writeStepOutput(ctx, step.id, {
          aborted: true,
          escalate: true,
          error: priorBag.error,
          feedback,
        });
        recordEvidence(ctx, {
          stepId: step.id,
          kind: "hitl",
          detail: { escalate: true, aborted: true, error: priorBag.error },
        });
        return; // hard abort
      }
      // Proceed / edit → skip item after human acknowledgment
      this.writeStepOutput(ctx, step.id, {
        skipped: true,
        reason: "onError",
        onError: "escalate_human",
        error: priorBag.error,
        feedback,
      });
      recordEvidence(ctx, {
        stepId: step.id,
        kind: "skip",
        detail: {
          reason: "onError",
          onError: "escalate_human",
          error: priorBag.error,
          humanProceed: true,
        },
      });
      return;
    }

    if (isAbortResponse(feedback)) {
      this.writeStepOutput(ctx, step.id, {
        aborted: true,
        feedback,
      });
      recordEvidence(ctx, {
        stepId: step.id,
        kind: "hitl",
        detail: { aborted: true },
      });
      return; // hard abort (default)
    }

    const prior = priorBag;
    const show = prior?.show;

    let output: unknown;
    if (isEditResponse(feedback)) {
      output = {
        approved: true,
        edited: true,
        text: feedback.value,
        value: feedback.value,
        show,
        feedback,
      };
    } else {
      output = {
        approved: true,
        value: feedback.value ?? true,
        show,
        feedback,
      };
    }

    this.writeStepOutput(ctx, step.id, output, feedback);
    recordEvidence(ctx, {
      stepId: step.id,
      kind: "hitl",
      detail: {
        approved: true,
        edited: isEditResponse(feedback),
        valueType: typeof feedback.value,
      },
    });

    if (step.enforce?.length) {
      await this.runEnforce(ctx, step.id, step.enforce, output, engine);
    }
  }

  async buildFeedbackContext(
    stage: StageDefinition,
    _fp: FeedbackPoint,
    context: AgentContext
  ): Promise<FeedbackContext | undefined> {
    const bag = (context.steps as WorkflowStepsBag | undefined)?.[stage.name]
      ?.output as { show?: unknown } | undefined;
    if (bag?.show !== undefined) {
      return showToFeedbackContext(bag.show, stage.name);
    }
    return context.feedbackContext as FeedbackContext | undefined;
  }

  async buildFeedbackPrompt(
    stage: StageDefinition,
    fp: FeedbackPoint,
    context: AgentContext
  ): Promise<string | undefined> {
    const bag = (context.steps as WorkflowStepsBag | undefined)?.[stage.name]
      ?.output as { prompt?: unknown } | undefined;
    if (typeof bag?.prompt === "string" && bag.prompt.trim()) {
      return bag.prompt;
    }
    return fp.description;
  }

  async buildFeedbackOptions(
    stage: StageDefinition,
    fp: FeedbackPoint,
    context: AgentContext
  ): Promise<string[] | undefined> {
    const bag = (context.steps as WorkflowStepsBag | undefined)?.[stage.name]
      ?.output as { options?: unknown } | undefined;
    if (Array.isArray(bag?.options)) {
      return bag.options.map((o) => String(o));
    }
    return fp.options;
  }

  private async runEnforce(
    ctx: AgentContext,
    stepId: string,
    ruleIds: string[],
    output: unknown,
    stageEngine?: ExecutionEngine
  ): Promise<void> {
    const scope = buildRefScope(ctx, this.lowered.relay);
    const llm =
      stageEngine?.type === "llm"
        ? stageEngine
        : this.engines.llm;

    try {
      const results = await enforceRules({
        ruleIds,
        rules: this.lowered.relay.rules,
        output,
        scope,
        llmEngine: llm,
        softFailClosed: this.softFailClosed,
      });
      recordEvidence(ctx, {
        stepId,
        kind: "enforce",
        detail: { results, passed: true },
      });
    } catch (err) {
      const results =
        err instanceof EnforceError ? err.results : undefined;
      recordEvidence(ctx, {
        stepId,
        kind: "enforce",
        detail: {
          passed: false,
          results,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      throw err;
    }
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
    if (
      prev !== null &&
      typeof prev === "object" &&
      !Array.isArray(prev)
    ) {
      ctx.stageResults[stepId] = {
        ...(prev as Record<string, unknown>),
        output,
        ...(feedback ? { feedback } : {}),
      };
    } else {
      ctx.stageResults[stepId] = { output, ...(feedback ? { feedback } : {}) };
    }
  }
}

function showToFeedbackContext(
  show: unknown,
  stepId: string
): FeedbackContext {
  if (typeof show === "string") {
    return { subjectId: stepId, body: show, title: stepId };
  }
  if (show && typeof show === "object" && !Array.isArray(show)) {
    const o = show as Record<string, unknown>;
    const body =
      typeof o.body === "string"
        ? o.body
        : typeof o.text === "string"
          ? o.text
          : typeof o.content === "string"
            ? o.content
            : JSON.stringify(show, null, 2);
    return {
      subjectId:
        typeof o.id === "string" ? o.id : typeof o.subjectId === "string" ? o.subjectId : stepId,
      title: typeof o.title === "string" ? o.title : stepId,
      body,
      url: typeof o.url === "string" ? o.url : undefined,
      meta: o,
    };
  }
  return {
    subjectId: stepId,
    title: stepId,
    body: show == null ? "" : JSON.stringify(show, null, 2),
  };
}
