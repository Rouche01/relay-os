import type {
  AgentContext,
  FeedbackRequest,
  FeedbackResponse,
  SpecV2,
  SpecV2Body,
} from "@relay/protocol";
import type { SpecHostMode } from "./types.js";

export const SPEC_RUN_CHECKPOINT_VERSION = 1 as const;

export type SpecRunStatus =
  | "running"
  | "waiting_you"
  | "complete"
  | "aborted"
  | "failed";

/**
 * Persisted Spec run snapshot for HITL pause / cross-process resume.
 * Secrets never appear here — only connection refs on the Spec body.
 */
export type SpecRunCheckpoint = {
  version: typeof SPEC_RUN_CHECKPOINT_VERSION;
  runId: string;
  specId: string;
  specHash: string;
  mode: SpecHostMode;
  status: SpecRunStatus;
  /** Index into lowered manifest stages of the paused / current stage. */
  stageIndex: number;
  stageName: string;
  pendingFeedback?: FeedbackRequest;
  /** Workflow context (steps, evidence, stageResults). */
  context: AgentContext;
  /** Frozen Spec record when available. */
  frozen: SpecV2;
  /** Authoring body (for rebuild). */
  body: SpecV2Body;
  dryRun: boolean;
  blockNetwork: boolean;
  savedAt: string;
  /** Last HITL decision after resume (audit). */
  lastFeedback?: FeedbackResponse;
};

export type RunStateStore = {
  save(checkpoint: SpecRunCheckpoint): void | Promise<void>;
  get(runId: string): SpecRunCheckpoint | undefined | Promise<SpecRunCheckpoint | undefined>;
  list?(): readonly SpecRunCheckpoint[] | Promise<readonly SpecRunCheckpoint[]>;
  delete?(runId: string): void | Promise<void>;
};

export function newRunId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `run_${crypto.randomUUID()}`;
  }
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function cloneContext(context: AgentContext): AgentContext {
  return structuredClone(context);
}
