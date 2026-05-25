export type EngineType = "browser" | "llm" | "api" | "code" | "data" | "comms";

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
  [key: string]: any;
}

// Forward declare to avoid circular dependency, though in practice
// these might live in feedback.ts and be imported.
import { FeedbackRequest } from "./feedback";
