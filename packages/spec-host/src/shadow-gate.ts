import { SpecHostError } from "./errors.js";
import type { SpecRunCheckpoint, RunStateStore } from "./checkpoint.js";
import { listRuns } from "./run-state-store.js";

/** Human approval of a shadow run's evidence pack (fail-closed before schedule enable). */
export type EvidenceApproval = {
  approvedAt: string;
  approvedBy?: string;
  note?: string;
};

export type ApproveShadowEvidenceOptions = {
  approvedBy?: string;
  note?: string;
  now?: string;
};

export type AssertShadowGateOptions = {
  store: RunStateStore;
  /** Spec content hash that must match the approved shadow run. */
  specHash: string;
  /** Optional Spec id filter. */
  specId?: string;
  /** Prefer a specific run; still validated against hash/mode/status/approval. */
  runId?: string;
};

function isApprovedShadowForGate(
  cp: SpecRunCheckpoint,
  opts: Pick<AssertShadowGateOptions, "specHash" | "specId">
): boolean {
  if (cp.mode !== "shadow") return false;
  if (cp.status !== "complete") return false;
  if (!cp.evidenceApproval?.approvedAt) return false;
  if (cp.specHash !== opts.specHash) return false;
  if (opts.specId && cp.specId !== opts.specId) return false;
  return true;
}

/**
 * Record human approval of a complete shadow run's evidence pack.
 * Idempotent when already approved. Fails closed for non-shadow / incomplete runs.
 */
export async function approveShadowEvidence(
  store: RunStateStore,
  runId: string,
  opts: ApproveShadowEvidenceOptions = {}
): Promise<SpecRunCheckpoint> {
  const cp = await store.get(runId);
  if (!cp) {
    throw new SpecHostError(
      "run_not_found",
      `Run not found: ${runId}`,
      { runId }
    );
  }
  if (cp.mode !== "shadow") {
    throw new SpecHostError(
      "shadow_approval_requires_shadow",
      `Evidence approval requires mode=shadow (got ${cp.mode})`,
      { runId, mode: cp.mode }
    );
  }
  if (cp.status !== "complete") {
    throw new SpecHostError(
      "shadow_approval_requires_complete",
      `Evidence approval requires a complete shadow run (status=${cp.status})`,
      { runId, status: cp.status }
    );
  }
  if (cp.evidenceApproval?.approvedAt) {
    return cp;
  }
  const now = opts.now ?? new Date().toISOString();
  const next: SpecRunCheckpoint = {
    ...cp,
    evidenceApproval: {
      approvedAt: now,
      approvedBy: opts.approvedBy,
      note: opts.note,
    },
    updatedAt: now,
    savedAt: now,
  };
  await store.save(next);
  return next;
}

/**
 * Fail closed: scheduled Spec enable requires ≥1 complete shadow run whose
 * evidence pack a human approved for this Spec hash.
 */
export async function assertShadowGate(
  options: AssertShadowGateOptions
): Promise<SpecRunCheckpoint> {
  const { store, specHash, specId, runId } = options;
  if (!specHash?.trim()) {
    throw new SpecHostError(
      "shadow_gate_missing_hash",
      "Shadow gate requires a Spec content hash"
    );
  }

  if (runId) {
    const cp = await store.get(runId);
    if (!cp) {
      throw new SpecHostError(
        "run_not_found",
        `Run not found: ${runId}`,
        { runId }
      );
    }
    if (!isApprovedShadowForGate(cp, { specHash, specId })) {
      throw new SpecHostError(
        "shadow_gate_unapproved",
        "Chosen run is not an approved complete shadow evidence pack for this Spec",
        {
          runId,
          mode: cp.mode,
          status: cp.status,
          hasApproval: Boolean(cp.evidenceApproval?.approvedAt),
          runHash: cp.specHash,
          expectedHash: specHash,
        }
      );
    }
    return cp;
  }

  const candidates = await listRuns(store, {
    specHash,
    specId,
    status: "complete",
    newestFirst: true,
  });
  const approved = candidates.find((cp) =>
    isApprovedShadowForGate(cp, { specHash, specId })
  );
  if (!approved) {
    throw new SpecHostError(
      "shadow_gate_unapproved",
      "Enabling a scheduled Spec requires ≥1 complete shadow run with human-approved evidence",
      { specHash, specId: specId ?? null, completeRuns: candidates.length }
    );
  }
  return approved;
}

/** List complete shadow runs that carry evidence approval for a Spec hash. */
export async function listApprovedShadowRuns(
  store: RunStateStore,
  query: { specHash: string; specId?: string; limit?: number }
): Promise<SpecRunCheckpoint[]> {
  const candidates = await listRuns(store, {
    specHash: query.specHash,
    specId: query.specId,
    status: "complete",
    newestFirst: true,
    limit: query.limit,
  });
  return candidates.filter((cp) =>
    isApprovedShadowForGate(cp, {
      specHash: query.specHash,
      specId: query.specId,
    })
  );
}
