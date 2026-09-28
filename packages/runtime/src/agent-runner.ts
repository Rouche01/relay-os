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
    private controller?: AppController
  ) {
    super();
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

    if (!stage.feedback_points?.length) {
      return;
    }

    for (const fp of stage.feedback_points) {
      await this.handleFeedbackPoint(stage, fp, engine);
    }
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

    const req: FeedbackRequest = {
      id: requestId,
      agentId: this.context.agentId,
      type: fp.type,
      prompt,
      required: fp.required,
      context,
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
      if (this.controller?.onFeedbackApplied) {
        await this.controller.onFeedbackApplied(stage, response, engine);
      }
      throw new AgentAbortError();
    }

    if (isEditResponse(response)) {
      this.applyEditToContext(stage, response, context);
    }

    this.setStageResult(stage.name, {
      feedback: response,
      ...(isEditResponse(response) ? { editedBody: response.value } : {}),
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
