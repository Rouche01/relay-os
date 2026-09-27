import { ExecutionEngine } from "./engines";
import { FeedbackRequest, FeedbackResponse } from "./feedback";

/**
 * Agent lifecycle states.
 * `ABORTED` — human chose abort; terminal, distinct from COMPLETE/FAILED.
 */
export type AgentState =
  | "PENDING"
  | "RUNNING"
  | "WAITING_USER"
  | "COMPLETE"
  | "ABORTED"
  | "FAILED";

export enum AgentRuntimeEvent {
  STATE_CHANGED = "state_changed",
  STAGE_STARTED = "stage_started",
  EXECUTE_STAGE_ACTION = "execute_stage_action",
  FEEDBACK_REQUESTED = "feedback_requested",
  FEEDBACK_RECEIVED = "feedback_received",
  FEEDBACK_APPLIED = "feedback_applied",
  ERROR = "error",
}

export interface AgentRuntimeEvents {
  [AgentRuntimeEvent.STATE_CHANGED]: (payload: { state: AgentState }) => void;
  [AgentRuntimeEvent.STAGE_STARTED]: (payload: { stage: string }) => void;
  [AgentRuntimeEvent.EXECUTE_STAGE_ACTION]: (payload: {
    stage: string;
    engine: ExecutionEngine;
  }) => void;
  [AgentRuntimeEvent.FEEDBACK_REQUESTED]: (req: FeedbackRequest) => void;
  [AgentRuntimeEvent.FEEDBACK_RECEIVED]: (res: FeedbackResponse) => void;
  [AgentRuntimeEvent.FEEDBACK_APPLIED]: (payload: {
    stage: string;
    response: FeedbackResponse;
  }) => void;
  [AgentRuntimeEvent.ERROR]: (error: any) => void;
}
