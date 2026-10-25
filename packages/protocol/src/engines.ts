import { FeedbackRequest } from "./feedback";

/**
 * Execution engines an agentic app may declare.
 * `"protocol"` — Spec-native declare/invoke/observe/evidence (preferred when addressable).
 * `"browser"` — Playwright / DOM GUI path.
 * `"computer"` — full desktop session (screenshot + OS input) via Computer Runtime gateway.
 * `"none"` — pure HITL gate (feedback only; no engine execute).
 */
export type EngineType =
  | "protocol"
  | "browser"
  | "computer"
  | "llm"
  | "api"
  | "code"
  | "data"
  | "comms"
  | "none";

export interface ExecutionEngine {
  type: EngineType;
  execute(action: EngineAction): Promise<EngineResult>;
  healthCheck(): Promise<boolean>;
  teardown(): Promise<void>;
}

export interface EngineAction {
  type: string;
  params: Record<string, any>;
  timeout_ms?: number;
  context?: AgentContext;
}

export interface EngineResult {
  success: boolean;
  data?: any;
  error?: string;
  feedback_required?: FeedbackRequest;
}

export interface AgentContext {
  agentId: string;
  userId: string;
  sessionId: string;
  /** Stage result bag — e.g. approved draft id for execute */
  stageResults?: Record<string, unknown>;
  [key: string]: any;
}
