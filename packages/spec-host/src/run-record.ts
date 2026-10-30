import type { AgentContext, FeedbackResponse, SpecV2, SpecV2Body } from "@relay/protocol";
import { getEvidence, type WorkflowEvidenceEntry } from "@relay/workflow-runtime";
import {
  cloneContext,
  type SpecRunCheckpoint,
  type SpecRunStatus,
} from "./checkpoint.js";
import type { SpecHostMode } from "./types.js";

export type BuildRunRecordInput = {
  runId: string;
  specId: string;
  specHash: string;
  mode: SpecHostMode;
  status: SpecRunStatus;
  stageIndex: number;
  stageName: string;
  context: AgentContext;
  frozen: SpecV2;
  body: SpecV2Body;
  dryRun: boolean;
  blockNetwork: boolean;
  stepOutputs?: Record<string, unknown>;
  pendingFeedback?: SpecRunCheckpoint["pendingFeedback"];
  lastFeedback?: FeedbackResponse;
  /** Prior checkpoint when updating (preserves createdAt + hitl history). */
  previous?: SpecRunCheckpoint;
  now?: string;
};

function stepOutputsFromContext(ctx: AgentContext): Record<string, unknown> {
  const steps = (ctx.steps ?? {}) as Record<string, { output?: unknown }>;
  const out: Record<string, unknown> = {};
  for (const [id, bag] of Object.entries(steps)) {
    out[id] = bag?.output;
  }
  return out;
}

/** Build a full run record suitable for RunStateStore.save. */
export function buildRunRecord(input: BuildRunRecordInput): SpecRunCheckpoint {
  const now = input.now ?? new Date().toISOString();
  const evidence: WorkflowEvidenceEntry[] = getEvidence(input.context);
  const stepOutputs =
    input.stepOutputs ?? stepOutputsFromContext(input.context);
  const priorDecisions = input.previous?.hitlDecisions ?? [];
  const hitlDecisions = input.lastFeedback
    ? [...priorDecisions, input.lastFeedback]
    : [...priorDecisions];

  const createdAt = input.previous?.createdAt ?? input.previous?.savedAt ?? now;

  return {
    version: 1,
    runId: input.runId,
    specId: input.specId,
    specHash: input.specHash,
    mode: input.mode,
    status: input.status,
    stageIndex: input.stageIndex,
    stageName: input.stageName,
    pendingFeedback: input.pendingFeedback,
    context: cloneContext(input.context),
    frozen: input.frozen,
    body: input.body,
    dryRun: input.dryRun,
    blockNetwork: input.blockNetwork,
    createdAt,
    updatedAt: now,
    savedAt: now,
    evidence,
    evidenceCount: evidence.length,
    stepOutputs,
    hitlDecisions,
    lastFeedback: input.lastFeedback ?? input.previous?.lastFeedback,
  };
}

export function statusFromRuntimeState(state: string): SpecRunStatus {
  switch (state) {
    case "WAITING_USER":
      return "waiting_you";
    case "COMPLETE":
      return "complete";
    case "ABORTED":
      return "aborted";
    case "FAILED":
      return "failed";
    case "RUNNING":
      return "running";
    default:
      return "failed";
  }
}
