/**
 * Structured validator results for scaffolder repair + Desk UI.
 */

export type SpecV2ValidationSeverity = "error" | "warning";

/**
 * Named invariants (verification-ready). Errors cite these when applicable.
 */
export type SpecV2InvariantId =
  | "inv_no_unbound_capability"
  | "inv_hitl_before_irreversible"
  | "inv_api_method_side_effect"
  | "inv_budget_bounds_loops"
  | "inv_rule_coverage"
  | "inv_service_operation_bound"
  | "inv_dataflow_refs"
  | "inv_structure"
  | "inv_once_idempotency"
  | "inv_retry_safe";

export type SpecV2ValidationIssue = {
  severity: SpecV2ValidationSeverity;
  /** Machine code for repair loops (e.g. unknown_capability). */
  code: string;
  message: string;
  /** JSON-pointer-ish path (e.g. steps/2/use). */
  path?: string;
  invariant?: SpecV2InvariantId;
  /** Optional step / rule id for UI highlighting. */
  stepId?: string;
  ruleId?: string;
};

export type SpecV2ValidationResult = {
  ok: boolean;
  errors: SpecV2ValidationIssue[];
  warnings: SpecV2ValidationIssue[];
  /** Wall time for this validate call (ms). */
  durationMs: number;
};
