import { StageDefinition, ExecutionEngine, FeedbackResponse } from "@relay/protocol";

export interface AppController {
  /** Invoked when a stage begins execution. */
  onStageStart?(stage: StageDefinition, engine: ExecutionEngine): Promise<void>;
  
  /** Invoked when a user has provided feedback for a stage. */
  onFeedbackApplied?(stage: StageDefinition, feedback: FeedbackResponse, engine: ExecutionEngine): Promise<void>;
}
