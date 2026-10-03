import { StageDefinition, ExecutionEngine, FeedbackResponse, FeedbackPoint, FeedbackContext, AgentContext } from "@relay/protocol";

export interface AppController {
  /** Invoked when a stage begins execution. `engine` is undefined for `engine: "none"`. */
  onStageStart?(stage: StageDefinition, engine?: ExecutionEngine): Promise<void>;

  /**
   * Invoked when a user has provided feedback for a stage.
   * Return `false` on an abort response to soft-abort: record the abort for
   * that feedback point but continue the stage loop (e.g. skip a CAPTCHA
   * challenge without killing the run). Default / `void` = hard abort.
   */
  onFeedbackApplied?(
    stage: StageDefinition,
    feedback: FeedbackResponse,
    engine?: ExecutionEngine
  ): void | boolean | Promise<void | boolean>;

  /**
   * Optional: build adapter-facing context for a feedback point
   * (subjectId, title, body, url, details, meta).
   */
  buildFeedbackContext?(
    stage: StageDefinition,
    feedbackPoint: FeedbackPoint,
    context: AgentContext
  ): FeedbackContext | undefined | Promise<FeedbackContext | undefined>;

  /**
   * Optional: skip a feedback point (e.g. intensity-2 confirmation when intensity < 2).
   */
  shouldSkipFeedbackPoint?(
    stage: StageDefinition,
    feedbackPoint: FeedbackPoint,
    context: AgentContext
  ): boolean | Promise<boolean>;

  /** Optional: override the prompt string shown to adapters. */
  buildFeedbackPrompt?(
    stage: StageDefinition,
    feedbackPoint: FeedbackPoint,
    context: AgentContext
  ): string | undefined | Promise<string | undefined>;
}
