import type { SpecV2Body } from "@relay/protocol";
import {
  validateSpecV2,
  type ValidateSpecV2Options,
  type SpecV2ValidationResult,
} from "@relay/spec-validator";
import { hashSpecV2 } from "./hash.js";
import type { LoweredWorkflow } from "./types.js";
import { LOWERED_WORKFLOW_KIND } from "./types.js";

export type LiftResult = {
  ok: boolean;
  spec: SpecV2Body;
  /** Hash of the lifted Spec (may differ from envelope if Spec was edited). */
  specHash: string;
  /** True when envelope.specHash matches the lifted Spec. */
  hashMatches: boolean;
  validation?: SpecV2ValidationResult;
  errors: string[];
};

export type LiftOptions = {
  /** When true (default), run validateSpecV2 on the lifted body. */
  validate?: boolean;
  validateOptions?: ValidateSpecV2Options;
  /**
   * When true, fail if envelope.specHash ≠ hash(spec).
   * Default true — runtime should refuse mismatched manifests.
   */
  requireHashMatch?: boolean;
};

/**
 * Lift a lowered workflow back to a Spec v2 body and re-check integrity.
 * Manifest stage edits alone do not change the Spec — edit `spec` / re-lower.
 */
export function liftLoweredWorkflow(
  lowered: LoweredWorkflow,
  options: LiftOptions = {}
): LiftResult {
  const errors: string[] = [];
  if (lowered.kind !== LOWERED_WORKFLOW_KIND) {
    errors.push(
      `Expected kind ${LOWERED_WORKFLOW_KIND}, got ${JSON.stringify(lowered.kind)}`
    );
  }
  if (lowered.version !== 1) {
    errors.push(`Unsupported lowered workflow version ${lowered.version}`);
  }

  const spec: SpecV2Body = {
    goal: lowered.spec.goal,
    connections: lowered.spec.connections,
    services: lowered.spec.services,
    budget: lowered.spec.budget,
    rules: lowered.spec.rules,
    steps: lowered.spec.steps,
  };

  const specHash = hashSpecV2(spec);
  const hashMatches = specHash === lowered.specHash;

  if (
    (options.requireHashMatch ?? true) &&
    !hashMatches
  ) {
    errors.push(
      `spec_hash mismatch: envelope ${lowered.specHash.slice(0, 12)}… ≠ body ${specHash.slice(0, 12)}… — re-lower after Spec edits`
    );
  }

  if (lowered.relay.specHash !== lowered.specHash) {
    errors.push("relay.specHash does not match envelope specHash");
  }

  let validation: SpecV2ValidationResult | undefined;
  if (options.validate !== false) {
    validation = validateSpecV2(spec, options.validateOptions);
    if (!validation.ok) {
      for (const e of validation.errors) {
        errors.push(`[${e.code}] ${e.message}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    spec,
    specHash,
    hashMatches,
    validation,
    errors,
  };
}

/**
 * Assert a lowered workflow is safe to run (hash + optional validate).
 * Throws on failure.
 */
export function assertLoweredRunnable(
  lowered: LoweredWorkflow,
  options?: LiftOptions
): SpecV2Body {
  const lifted = liftLoweredWorkflow(lowered, options);
  if (!lifted.ok) {
    throw new Error(
      `Lowered workflow not runnable:\n- ${lifted.errors.join("\n- ")}`
    );
  }
  return lifted.spec;
}
