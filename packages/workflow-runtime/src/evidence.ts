import type { AgentContext } from "@relay/protocol";
import type { WorkflowEvidenceEntry } from "./types.js";

const EVIDENCE_KEY = "evidence" as const;

/** Append an evidence entry onto AgentContext.evidence (creates the array). */
export function recordEvidence(
  ctx: AgentContext,
  entry: Omit<WorkflowEvidenceEntry, "at"> & { at?: string }
): WorkflowEvidenceEntry {
  const full: WorkflowEvidenceEntry = {
    at: entry.at ?? new Date().toISOString(),
    stepId: entry.stepId,
    kind: entry.kind,
    detail: entry.detail,
  };
  const list = Array.isArray(ctx[EVIDENCE_KEY])
    ? (ctx[EVIDENCE_KEY] as WorkflowEvidenceEntry[])
    : [];
  list.push(full);
  ctx[EVIDENCE_KEY] = list;
  return full;
}

/** Read the evidence trail from context (empty if none). */
export function getEvidence(ctx: AgentContext): WorkflowEvidenceEntry[] {
  return Array.isArray(ctx[EVIDENCE_KEY])
    ? ([...(ctx[EVIDENCE_KEY] as WorkflowEvidenceEntry[])] as WorkflowEvidenceEntry[])
    : [];
}
