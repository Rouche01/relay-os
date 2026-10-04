import { EventEmitter } from "node:events";
import {
  AgenticAppManifest,
  ExecutionEngine,
  AgentContext,
  FeedbackRequest,
  FeedbackResponse,
  FeedbackPoint,
  FeedbackContext,
  StageDefinition,
  AgentState,
  AgentRuntimeEvents,
  AgentRuntimeEvent,
  isAbortResponse,
  isEditResponse,
} from "@relay/protocol";
import { AppController } from "./types";
import { assertEnginesForManifest } from "./bind-engines";
import {
  fanoutSleep,
  itemIdOf,
  resolveFanoutOutcome,
  summarizeFanout,
  type FanoutChildResult,
  type FanoutHost,
} from "./fanout";

/** Thrown internally to unwind the stage loop on human abort. */
class AgentAbortError extends Error {
  constructor() {
    super("Agent aborted by user feedback");
    this.name = "AgentAbortError";
  }
}

export interface AgentRuntime {
  on<K extends keyof AgentRuntimeEvents>(event: K, listener: AgentRuntimeEvents[K]): this;
  once<K extends keyof AgentRuntimeEvents>(event: K, listener: AgentRuntimeEvents[K]): this;
  off<K extends keyof AgentRuntimeEvents>(event: K, listener: AgentRuntimeEvents[K]): this;
  addListener<K extends keyof AgentRuntimeEvents>(event: K, listener: AgentRuntimeEvents[K]): this;
  removeListener<K extends keyof AgentRuntimeEvents>(event: K, listener: AgentRuntimeEvents[K]): this;
  emit<K extends keyof AgentRuntimeEvents>(event: K, ...args: Parameters<AgentRuntimeEvents[K]>): boolean;
}

export class AgentRuntime extends EventEmitter {
  private state: AgentState = "PENDING";
  private context: AgentContext;
  private pendingFeedbackResolver: ((response: FeedbackResponse) => void) | null = null;
  private pendingRequestId: string | null = null;

  constructor(
    private manifest: AgenticAppManifest,
    private engines: Record<string, ExecutionEngine>,
    initialContext: AgentContext,
    private controller?: AppController,
    /** Required when the manifest has a `fanout` stage. Not passed to children (no recursive fanout). */
    private fanoutHost?: FanoutHost
  ) {
    super();
    assertEnginesForManifest(manifest, engines);
    this.context = {
      ...initialContext,
      stageResults: { ...(initialContext.stageResults ?? {}) },
    };
  }

  public getState(): AgentState {
    return this.state;
  }

  public getContext(): AgentContext {
    return this.context;
  }

  public getManifest(): AgenticAppManifest {
    return this.manifest;
  }

  /** Read a value previously stored for a stage (e.g. approved draft). */
  public getStageResult<T = unknown>(stageName: string): T | undefined {
    return this.context.stageResults?.[stageName] as T | undefined;
  }

  /** Merge into the stage result bag (available to later stages / execute). */
  public setStageResult(stageName: string, value: unknown): void {
    if (!this.context.stageResults) {
      this.context.stageResults = {};
    }
    const prev = this.context.stageResults[stageName];
    if (
      prev !== null &&
      typeof prev === "object" &&
      !Array.isArray(prev) &&
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      this.context.stageResults[stageName] = {
        ...(prev as Record<string, unknown>),
        ...(value as Record<string, unknown>),
      };
    } else {
      this.context.stageResults[stageName] = value;
    }
  }

  public async start(): Promise<void> {
    if (this.state !== "PENDING") {
      throw new Error(`Cannot start agent from state: ${this.state}`);
    }

    this.updateState("RUNNING");

    try {
      for (const stage of this.manifest.stages) {
        await this.executeStage(stage);
      }
      this.updateState("COMPLETE");
    } catch (error) {
      if (error instanceof AgentAbortError) {
        this.updateState("ABORTED");
        return;
      }
      this.updateState("FAILED");
      this.emit(AgentRuntimeEvent.ERROR, error);
    }
  }

  public async provideFeedback(response: FeedbackResponse): Promise<void> {
    if (this.state !== "WAITING_USER") {
      throw new Error(`Agent is not waiting for feedback. Current state: ${this.state}`);
    }
    if (this.pendingRequestId && response.requestId !== this.pendingRequestId) {
      throw new Error(
        `Feedback requestId mismatch. Expected ${this.pendingRequestId}, got ${response.requestId}`
      );
    }

    this.emit(AgentRuntimeEvent.FEEDBACK_RECEIVED, response);

    // Stay WAITING_USER until abort/proceed is decided; abort never resumes RUNNING.
    if (isAbortResponse(response)) {
      if (this.pendingFeedbackResolver) {
        this.pendingFeedbackResolver(response);
        this.pendingFeedbackResolver = null;
        this.pendingRequestId = null;
      }
      return;
    }

    this.updateState("RUNNING");

    if (this.pendingFeedbackResolver) {
      this.pendingFeedbackResolver(response);
      this.pendingFeedbackResolver = null;
      this.pendingRequestId = null;
    }
  }

  private resolveEngine(stage: StageDefinition): ExecutionEngine | undefined {
    if (stage.engine === "none") {
      return undefined;
    }
    const engine = this.engines[stage.engine];
    if (!engine) {
      throw new Error(`Required engine not found: ${stage.engine}`);
    }
    return engine;
  }

  private async executeStage(stage: StageDefinition): Promise<void> {
    const engine = this.resolveEngine(stage);

    this.emit(AgentRuntimeEvent.STAGE_STARTED, { stage: stage.name });

    if (this.controller?.onStageStart) {
      await this.controller.onStageStart(stage, engine);
    }

    if (stage.fanout) {
      await this.executeFanout(stage);
      return;
    }

    if (!stage.feedback_points?.length) {
      return;
    }

    for (const fp of stage.feedback_points) {
      await this.handleFeedbackPoint(stage, fp, engine);
    }
  }

  /**
   * Expand `stage.fanout` into N isolated child AgentRuntimes (serial).
   * Child abort/fail is recorded; the parent continues.
   */
  private async executeFanout(stage: StageDefinition): Promise<void> {
    const fanout = stage.fanout!;
    if (!this.fanoutHost) {
      throw new Error(
        `Stage "${stage.name}" declares fanout but AgentRuntime was constructed without a FanoutHost`
      );
    }
    if (fanout.mode && fanout.mode !== "serial") {
      throw new Error(
        `Stage "${stage.name}" fanout mode "${fanout.mode}" is not supported (v1: serial only)`
      );
    }

    const raw = this.context[fanout.from];
    if (raw !== undefined && !Array.isArray(raw)) {
      throw new Error(
        `Fanout stage "${stage.name}": context.${fanout.from} must be an array`
      );
    }
    const items = (raw as unknown[] | undefined) ?? [];

    const overrides = this.fanoutHost.resolveFanoutConfig?.(stage) ?? {};
    const max = overrides.max ?? fanout.max ?? items.length;
    const delayMs = overrides.delayMs ?? fanout.delay_ms ?? 0;
    const queue = items.slice(0, Math.max(0, max));
    const itemKey = fanout.itemKey ?? "item";
    const children: FanoutChildResult[] = [];

    for (let i = 0; i < queue.length; i++) {
      const item = queue[i]!;
      const label =
        this.fanoutHost.describeItem?.(item, i) ??
        itemIdOf(item) ??
        `#${i + 1}`;
      console.log(
        `\n=== Fanout ${stage.name} ${i + 1}/${queue.length} · ${label} ===`
      );

      children.push(
        await this.runFanoutChild(stage, item, i, itemKey, label)
      );

      if (i < queue.length - 1 && delayMs > 0) {
        await fanoutSleep(delayMs);
      }
    }

    const summary = summarizeFanout(stage.name, items.length, children);
    this.setStageResult(stage.name, summary);
    this.context.fanoutSummary = summary;
    console.log(
      `[fanout] ${stage.name} complete=${summary.complete} aborted=${summary.aborted} failed=${summary.failed} skipped=${summary.skipped}`
    );
  }

  private async runFanoutChild(
    stage: StageDefinition,
    item: unknown,
    index: number,
    itemKey: string,
    label: string
  ): Promise<FanoutChildResult> {
    const fanout = stage.fanout!;
    const base = {
      index,
      itemId: itemIdOf(item),
    };

    let child: AgentRuntime | undefined;
    let runtimeError: string | undefined;

    try {
      const ref: { runtime?: AgentRuntime } = {};
      const childController = await this.fanoutHost!.createChildController(
        stage,
        item,
        index,
        () => {
          if (!ref.runtime) {
            throw new Error("fanout child runtime accessed before initialisation");
          }
          return ref.runtime.getContext();
        }
      );

      child = new AgentRuntime(
        fanout.manifest,
        this.engines,
        {
          agentId: `${this.context.agentId}-${stage.name}-${index + 1}`,
          userId: this.context.userId,
          sessionId: this.context.sessionId,
          [itemKey]: item,
        },
        childController
        // no fanoutHost — children cannot nest further in v1
      );
      ref.runtime = child;

      child.on(AgentRuntimeEvent.ERROR, (err: unknown) => {
        runtimeError = err instanceof Error ? err.message : String(err);
      });

      await this.fanoutHost!.onChildStart?.(child, item, index);
      await child.start();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.warn(`[fanout] ${label} failed outside the stage loop: ${error}`);
      return { ...base, state: "FAILED", outcome: "failed", error };
    } finally {
      if (child) await this.fanoutHost!.onChildEnd?.(child, item, index);
    }

    const ctx = child.getContext();
    const state = child.getState();
    const outcome = resolveFanoutOutcome(state, ctx.hitlOutcome);
    let execError: string | undefined;
    if (
      outcome === "failed" &&
      typeof ctx.executeResult === "object" &&
      ctx.executeResult &&
      "error" in ctx.executeResult
    ) {
      const e = (ctx.executeResult as { error?: unknown }).error;
      if (e != null) execError = String(e);
    }

    const result: FanoutChildResult = {
      ...base,
      state,
      outcome,
      hitlOutcome: ctx.hitlOutcome,
      executeResult: ctx.executeResult,
      error: outcome === "failed" ? runtimeError ?? execError : undefined,
    };

    console.log(
      `[fanout] ${label} → ${outcome}${result.error ? ` (${result.error})` : ""}`
    );
    return result;
  }

  private async handleFeedbackPoint(
    stage: StageDefinition,
    fp: FeedbackPoint,
    engine: ExecutionEngine | undefined
  ): Promise<void> {
    if (this.controller?.shouldSkipFeedbackPoint) {
      const skip = await this.controller.shouldSkipFeedbackPoint(
        stage,
        fp,
        this.context
      );
      if (skip) return;
    }

    const context = await this.resolveFeedbackContext(stage, fp);
    const requestId = this.createRequestId();

    let prompt = fp.description;
    if (this.controller?.buildFeedbackPrompt) {
      const override = await this.controller.buildFeedbackPrompt(
        stage,
        fp,
        this.context
      );
      if (override) prompt = override;
    }

    let options = fp.options;
    if (this.controller?.buildFeedbackOptions) {
      const dynamic = await this.controller.buildFeedbackOptions(
        stage,
        fp,
        this.context
      );
      if (dynamic !== undefined) options = dynamic;
    }

    const req: FeedbackRequest = {
      id: requestId,
      agentId: this.context.agentId,
      type: fp.type,
      prompt,
      required: fp.required,
      context,
      options,
      timeout_ms: fp.timeout_ms ?? stage.timeout_ms,
    };

    // Optional feedback: notify listeners but do not block the stage loop.
    if (!fp.required) {
      this.emit(AgentRuntimeEvent.FEEDBACK_REQUESTED, req);
      return;
    }

    this.updateState("WAITING_USER");
    this.pendingRequestId = requestId;

    const feedbackPromise = new Promise<FeedbackResponse>((resolve) => {
      this.pendingFeedbackResolver = resolve;
    });

    this.emit(AgentRuntimeEvent.FEEDBACK_REQUESTED, req);

    const response = await this.awaitFeedback(feedbackPromise, req.timeout_ms);

    if (isAbortResponse(response)) {
      this.setStageResult(stage.name, {
        feedback: response,
        aborted: true,
      });
      this.emit(AgentRuntimeEvent.FEEDBACK_APPLIED, { stage: stage.name, response });
      let hardAbort = true;
      if (this.controller?.onFeedbackApplied) {
        const cont = await this.controller.onFeedbackApplied(
          stage,
          response,
          engine
        );
        // Explicit false → soft abort (continue the run).
        if (cont === false) hardAbort = false;
      }
      if (hardAbort) throw new AgentAbortError();
      return;
    }

    if (isEditResponse(response) && (fp.type === "approval" || fp.type === "freeform")) {
      this.applyEditToContext(stage, response, context);
    }

    this.setStageResult(stage.name, {
      feedback:
        fp.type === "credential"
          ? {
              requestId: response.requestId,
              agentId: response.agentId,
              action: response.action ?? "proceed",
              // Never persist credential secrets in stageResults
              redacted: true,
            }
          : response,
      ...(isEditResponse(response) && (fp.type === "approval" || fp.type === "freeform")
        ? { editedBody: response.value }
        : {}),
    });

    this.emit(AgentRuntimeEvent.FEEDBACK_APPLIED, { stage: stage.name, response });

    if (this.controller?.onFeedbackApplied) {
      await this.controller.onFeedbackApplied(stage, response, engine);
    }
  }

  private async resolveFeedbackContext(
    stage: StageDefinition,
    fp: FeedbackPoint
  ): Promise<FeedbackContext | undefined> {
    if (this.controller?.buildFeedbackContext) {
      return this.controller.buildFeedbackContext(stage, fp, this.context);
    }
    // Fallback: last stage result shaped as FeedbackContext-ish, or explicit bag.
    const fromBag = this.context.feedbackContext as FeedbackContext | undefined;
    if (fromBag) return fromBag;
    return undefined;
  }

  /**
   * Persist freeform/approval edits into the stage bag and refresh
   * feedbackContext.body so later stages (execute) see the revised content.
   */
  private applyEditToContext(
    stage: StageDefinition,
    response: FeedbackResponse,
    prior?: FeedbackContext
  ): void {
    const editedBody = response.value as string;
    const nextContext: FeedbackContext = {
      ...(prior ?? {}),
      body: editedBody,
      subjectId: prior?.subjectId,
    };
    this.context.feedbackContext = nextContext;
    this.setStageResult(stage.name, {
      editedBody,
      feedbackContext: nextContext,
    });
  }

  private awaitFeedback(
    feedbackPromise: Promise<FeedbackResponse>,
    timeout_ms?: number
  ): Promise<FeedbackResponse> {
    if (!timeout_ms || timeout_ms <= 0) {
      return feedbackPromise;
    }

    return new Promise<FeedbackResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingFeedbackResolver = null;
        this.pendingRequestId = null;
        reject(new Error(`Feedback timed out after ${timeout_ms}ms`));
      }, timeout_ms);

      feedbackPromise.then(
        (res) => {
          clearTimeout(timer);
          resolve(res);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  private createRequestId(): string {
    return Math.random().toString(36).substring(2, 10);
  }

  private updateState(newState: AgentState) {
    this.state = newState;
    this.emit(AgentRuntimeEvent.STATE_CHANGED, { state: newState });
  }
}

export type { FanoutHost, FanoutChildResult };
