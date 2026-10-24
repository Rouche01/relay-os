import {
  evaluateSpecEvidence,
  formatEvidenceIncomplete,
  type EvidenceObservation,
  type EvidencePhase,
  type Spec,
  type SpecEvidencePack,
} from "@relay/protocol";
import type { AgentContext } from "@relay/protocol";
import type { CommunityDraft } from "../types.js";
import type { HitlEvidence } from "../metrics/run-evidence.js";

/**
 * Build observations for CommunityEngager job context against a Spec's
 * acceptance ids (from engage-compiler v1).
 */
export function observeEngageJobEvidence(
  ctx: AgentContext,
  phase: EvidencePhase = "pre_execute"
): Record<string, EvidenceObservation> {
  const draft = ctx.currentDraft as CommunityDraft | undefined;
  const opportunity = ctx.opportunity as CommunityDraft | undefined;
  const hitlOutcome = String(ctx.hitlOutcome ?? "");
  const hitl = ctx.stageResults?.hitl as HitlEvidence | undefined;
  const execute = ctx.stageResults?.execute as
    | { ok?: boolean; dryRun?: boolean; error?: string }
    | undefined;

  const out: Record<string, EvidenceObservation> = {};

  // Parent scout/post_watch: job exists ⇒ listing produced work for this child.
  if (draft || opportunity) {
    out.scout_complete = {
      status: "satisfied",
      detail: "Job opportunity present on child context",
    };
    out.post_watch_complete = {
      status: "satisfied",
      detail: "Job opportunity present on child context",
    };
  } else {
    out.scout_complete = {
      status: "missing",
      detail: "No opportunity/draft on context",
    };
    out.post_watch_complete = {
      status: "missing",
      detail: "No opportunity/draft on context",
    };
  }

  if (draft?.draftText?.trim() || draft?.id) {
    out.draft_present = {
      status: "satisfied",
      detail: draft.id ? `draft=${draft.id}` : "draft text present",
    };
  } else {
    out.draft_present = {
      status: "missing",
      detail: "currentDraft missing or empty",
    };
  }

  if (hitlOutcome === "approved" || hitlOutcome === "edited") {
    out.hitl_decision = {
      status: "satisfied",
      detail: `hitlOutcome=${hitlOutcome}`,
    };
  } else if (hitlOutcome === "aborted") {
    out.hitl_decision = {
      status: "failed",
      detail: "aborted — must not execute",
    };
  } else {
    out.hitl_decision = {
      status: "missing",
      detail: hitlOutcome
        ? `hitlOutcome=${hitlOutcome}`
        : "No HITL decision yet",
    };
  }

  const intensity = draft?.intensity ?? 0;
  if (intensity >= 2) {
    if (hitl?.intensity2Confirmed) {
      out.intensity2_gate = {
        status: "satisfied",
        detail: "intensity2Confirmed",
      };
    } else {
      out.intensity2_gate = {
        status: "missing",
        detail: "Intensity 2 requires confirmation HITL",
      };
    }
  } else {
    out.intensity2_gate = {
      status: "skipped",
      detail: `intensity=${intensity} — gate N/A`,
    };
  }

  if (phase === "post_execute" || phase === "run") {
    if (execute?.ok) {
      out.execute_evidence = {
        status: "satisfied",
        detail: execute.dryRun ? "dry-run ok" : "execute ok",
      };
    } else if (execute) {
      out.execute_evidence = {
        status: "failed",
        detail: execute.error ?? "execute not ok",
      };
    } else {
      out.execute_evidence = {
        status: "missing",
        detail: "No execute stageResults yet",
      };
    }
  }

  return out;
}

/** Evaluate job context against Spec; returns pack (may be incomplete). */
export function buildEngageJobEvidencePack(
  spec: Spec,
  ctx: AgentContext,
  phase: EvidencePhase = "pre_execute"
): SpecEvidencePack {
  return evaluateSpecEvidence(
    spec,
    phase,
    observeEngageJobEvidence(ctx, phase)
  );
}

/**
 * Fail closed before irreversible execute when Spec is active on context.
 * No-op when ctx.spec is absent (legacy runs without Spec).
 */
export function assertEngagePreExecuteEvidence(ctx: AgentContext): SpecEvidencePack | null {
  const spec = ctx.spec as Spec | undefined;
  if (!spec) return null;
  if (spec.status !== "frozen" && spec.status !== "running") {
    throw new Error(
      `Spec on context must be frozen or running before execute (got "${spec.status}")`
    );
  }

  const pack = buildEngageJobEvidencePack(spec, ctx, "pre_execute");
  ctx.stageResults = {
    ...(ctx.stageResults ?? {}),
    evidencePack: pack,
  };

  if (!pack.complete) {
    throw new Error(formatEvidenceIncomplete(pack));
  }
  return pack;
}
