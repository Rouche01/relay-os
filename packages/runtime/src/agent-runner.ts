import { EventEmitter } from "node:events";
import {
  AgenticAppManifest,
  ExecutionEngine,
  AgentContext,
  FeedbackRequest,
  FeedbackResponse,
  StageDefinition,
  AgentState,
  AgentRuntimeEvents,
  AgentRuntimeEvent
} from "@relay/protocol";
import { AppController } from "./types";

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

  constructor(
    private manifest: AgenticAppManifest,
    private engines: Record<string, ExecutionEngine>,
    initialContext: AgentContext,
    private controller?: AppController
  ) {
    super();
    this.context = initialContext;
  }

  public getState(): AgentState {
    return this.state;
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
      this.updateState("FAILED");
      this.emit(AgentRuntimeEvent.ERROR, error);
    }
  }

  public async provideFeedback(response: FeedbackResponse): Promise<void> {
    if (this.state !== "WAITING_USER") {
      throw new Error(`Agent is not waiting for feedback. Current state: ${this.state}`);
    }

    this.emit(AgentRuntimeEvent.FEEDBACK_RECEIVED, response);
    this.updateState("RUNNING");

    if (this.pendingFeedbackResolver) {
      this.pendingFeedbackResolver(response);
      this.pendingFeedbackResolver = null;
    }
  }

  private async executeStage(stage: StageDefinition): Promise<void> {
    const engine = this.engines[stage.engine];
    if (!engine) {
      throw new Error(`Required engine not found: ${stage.engine}`);
    }

    this.emit(AgentRuntimeEvent.STAGE_STARTED, { stage: stage.name });

    if (this.controller?.onStageStart) {
      await this.controller.onStageStart(stage, engine);
    }

    // If this stage requires feedback, pause execution
    if (stage.feedback_points && stage.feedback_points.length > 0) {
      for (const fp of stage.feedback_points) {
        this.updateState("WAITING_USER");

        const feedbackPromise = new Promise<FeedbackResponse>((resolve) => {
          this.pendingFeedbackResolver = resolve;
        });

        const req: FeedbackRequest = {
          id: Math.random().toString(36).substring(7),
          agentId: this.context.agentId,
          type: fp.type,
          prompt: fp.description,
          required: fp.required
        };

        this.emit(AgentRuntimeEvent.FEEDBACK_REQUESTED, req);

        // Wait for the user to call provideFeedback()
        const response = await feedbackPromise;
        
        if (this.controller?.onFeedbackApplied) {
          await this.controller.onFeedbackApplied(stage, response, engine);
        }
      }
    }
  }

  private updateState(newState: AgentState) {
    this.state = newState;
    this.emit(AgentRuntimeEvent.STATE_CHANGED, { state: newState });
  }
}
