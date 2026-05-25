export type FeedbackType =
  | "approval"
  | "choice"
  | "freeform"
  | "credential"
  | "progress"
  | "error"
  | "confirmation";

export interface FeedbackRequest {
  id: string;
  agentId: string;
  type: FeedbackType;
  prompt: string;
  required: boolean;
  options?: string[];     // For "choice" type
  context?: any;          // Extra data for UI rendering (e.g. image preview for approval)
  timeout_ms?: number;    // How long before the request expires/escalates
}

export interface FeedbackResponse {
  requestId: string;
  agentId: string;
  value: any;             // The user's input (boolean, string, selected option)
  action?: "abort" | "retry" | "proceed"; // Used primarily for error/confirmation types
}
