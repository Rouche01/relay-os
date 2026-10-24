import type { Spec, SpecAcceptanceItem } from "./spec";

/**
 * Evidence pack — proof that Spec acceptance items are met.
 * Apps fill observations; {@link evaluateSpecEvidence} fails closed when
 * required items are missing/failed for the given phase.
 */

export type EvidenceItemStatus =
  | "satisfied"
  | "missing"
  | "failed"
  | "skipped";

export type EvidencePhase = "pre_execute" | "post_execute" | "run";

export interface EvidenceItemResult {
  acceptanceId: string;
  kind: SpecAcceptanceItem["kind"];
  description: string;
  status: EvidenceItemStatus;
  detail?: string;
}

export interface SpecEvidencePack {
  specId: string;
  specVersion: number;
  phase: EvidencePhase;
  items: EvidenceItemResult[];
  /** True when every non-skipped item is satisfied. */
  complete: boolean;
  /** Acceptance ids that block progress. */
  blocking: string[];
}

/** Per acceptance id: what the run observed. */
export type EvidenceObservation = {
  status: EvidenceItemStatus;
  detail?: string;
};

/**
 * Acceptance ids that only apply after execute (not pre-execute gates).
 * Apps may still observe them; evaluator skips them in `pre_execute` phase
 * unless the observation is already `failed`.
 */
const POST_EXECUTE_IDS = new Set(["execute_evidence"]);

export function evaluateSpecEvidence(
  spec: Spec,
  phase: EvidencePhase,
  observations: Record<string, EvidenceObservation | undefined>
): SpecEvidencePack {
  const items: EvidenceItemResult[] = [];
  const blocking: string[] = [];

  for (const acc of spec.acceptance) {
    const obs = observations[acc.id];
    let status: EvidenceItemStatus;
    let detail = obs?.detail;

    if (phase === "pre_execute" && POST_EXECUTE_IDS.has(acc.id)) {
      status = obs?.status === "failed" ? "failed" : "skipped";
      detail =
        detail ??
        (status === "skipped"
          ? "Checked after execute — not required pre-execute"
          : detail);
    } else if (!obs) {
      status = "missing";
      detail = detail ?? "No observation for this acceptance item";
    } else {
      status = obs.status;
    }

    items.push({
      acceptanceId: acc.id,
      kind: acc.kind,
      description: acc.description,
      status,
      detail,
    });

    if (status === "missing" || status === "failed") {
      blocking.push(acc.id);
    }
  }

  return {
    specId: spec.id,
    specVersion: spec.version,
    phase,
    items,
    complete: blocking.length === 0,
    blocking,
  };
}

/** Human-readable failure line for logs / thrown errors. */
export function formatEvidenceIncomplete(pack: SpecEvidencePack): string {
  const parts = pack.items
    .filter((i) => i.status === "missing" || i.status === "failed")
    .map(
      (i) =>
        `${i.acceptanceId}=${i.status}${i.detail ? ` (${i.detail})` : ""}`
    );
  return (
    `Spec evidence incomplete (spec=${pack.specId} v${pack.specVersion} phase=${pack.phase}): ` +
    (parts.length ? parts.join("; ") : "unknown")
  );
}
