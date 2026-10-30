import type {
  AgentContext,
  FeedbackRequest,
  FeedbackResponse,
  SpecV2,
  SpecV2Body,
} from "@relay/protocol";
import type { WorkflowEvidenceEntry } from "@relay/workflow-runtime";
import type { SpecHostMode } from "./types.js";

export const SPEC_RUN_CHECKPOINT_VERSION = 1 as const;

export type SpecRunStatus =
  | "running"
  | "waiting_you"
  | "complete"
  | "aborted"
  | "failed";

/**
 * Persisted Spec run snapshot for HITL pause / cross-process resume / Desk history.
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
  /** Authoring body (for rebuild / replay). */
  body: SpecV2Body;
  dryRun: boolean;
  blockNetwork: boolean;
  /** First save time (ISO). */
  createdAt: string;
  /** Last save time (ISO). Alias historically mirrored as savedAt. */
  updatedAt: string;
  /** @deprecated use updatedAt — kept for older checkpoints. */
  savedAt: string;
  /** Denormalized evidence trail for Desk without digging into context. */
  evidence?: WorkflowEvidenceEntry[];
  evidenceCount?: number;
  /** Denormalized step outputs. */
  stepOutputs?: Record<string, unknown>;
  /** Ordered HITL decisions for this run. */
  hitlDecisions?: FeedbackResponse[];
  /** Last HITL decision after resume (also appended to hitlDecisions). */
  lastFeedback?: FeedbackResponse;
  /**
   * Human approval of this shadow run's evidence pack.
   * Required (via assertShadowGate) before enabling a scheduled Spec.
   */
  evidenceApproval?: {
    approvedAt: string;
    approvedBy?: string;
    note?: string;
  };
};

/** Lightweight row for Desk run lists. */
export type SpecRunSummary = {
  runId: string;
  specId: string;
  specHash: string;
  status: SpecRunStatus;
  mode: SpecHostMode;
  stageName: string;
  createdAt: string;
  updatedAt: string;
  evidenceCount: number;
  hitlDecisionCount: number;
  dryRun: boolean;
  goal: string;
  /** True when this complete shadow run has evidenceApproval. */
  evidenceApproved: boolean;
};

export type ListRunsQuery = {
  specId?: string;
  specHash?: string;
  status?: SpecRunStatus | readonly SpecRunStatus[];
  limit?: number;
  /** Newest first (default true). */
  newestFirst?: boolean;
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

export function checkpointUpdatedAt(cp: SpecRunCheckpoint): string {
  return cp.updatedAt || cp.savedAt;
}

export function checkpointCreatedAt(cp: SpecRunCheckpoint): string {
  return cp.createdAt || cp.savedAt;
}

export function toRunSummary(cp: SpecRunCheckpoint): SpecRunSummary {
  return {
    runId: cp.runId,
    specId: cp.specId,
    specHash: cp.specHash,
    status: cp.status,
    mode: cp.mode,
    stageName: cp.stageName,
    createdAt: checkpointCreatedAt(cp),
    updatedAt: checkpointUpdatedAt(cp),
    evidenceCount: cp.evidenceCount ?? cp.evidence?.length ?? 0,
    hitlDecisionCount: cp.hitlDecisions?.length ?? (cp.lastFeedback ? 1 : 0),
    dryRun: cp.dryRun,
    goal: cp.body.goal ?? cp.frozen.goal ?? "",
    evidenceApproved: Boolean(cp.evidenceApproval?.approvedAt),
  };
}

export function filterCheckpoints(
  runs: readonly SpecRunCheckpoint[],
  query: ListRunsQuery = {}
): SpecRunCheckpoint[] {
  const statuses = query.status
    ? new Set(Array.isArray(query.status) ? query.status : [query.status])
    : null;
  let out = runs.filter((r) => {
    if (query.specId && r.specId !== query.specId) return false;
    if (query.specHash && r.specHash !== query.specHash) return false;
    if (statuses && !statuses.has(r.status)) return false;
    return true;
  });
  const newestFirst = query.newestFirst !== false;
  out = [...out].sort((a, b) => {
    const ta = checkpointUpdatedAt(a);
    const tb = checkpointUpdatedAt(b);
    return newestFirst ? (ta < tb ? 1 : ta > tb ? -1 : 0) : ta < tb ? -1 : ta > tb ? 1 : 0;
  });
  if (query.limit != null && query.limit >= 0) {
    out = out.slice(0, query.limit);
  }
  return out;
}
