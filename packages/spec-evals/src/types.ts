import type {
  AgentContext,
  ExecutionEngine,
  SpecV2Body,
  SpecV2Rule,
} from "@relay/protocol";
import type { LoweredWorkflow } from "@relay/spec-lower";

/** One rule compiled into an eval unit. */
export type CompiledEval = {
  ruleId: string;
  kind: SpecV2Rule["kind"];
  rule: SpecV2Rule;
  /** Step ids that list this rule in `enforce` (empty for outcome / uncovered). */
  enforcedBy: string[];
};

export type CompiledEvalSuite = {
  goal: string;
  specHash?: string;
  evals: CompiledEval[];
  /** Hard/soft rules not listed in any step.enforce. */
  uncovered: string[];
  /** Outcome rules (declared metrics; measured post-run). */
  outcomes: CompiledEval[];
};

/**
 * One offline fixture case. Supplies synthetic output + scope and asserts
 * which rules pass or fail (fail-closed gate before live run).
 */
export type EvalCase = {
  id: string;
  /** Human description for reports / Desk UI. */
  description?: string;
  /**
   * Step id under test — when set, defaults `rules` to that step's `enforce`
   * list (or all hard/soft if the step has none).
   */
  stepId?: string;
  /** Synthetic step output (also available as `${output}` / step shorthand). */
  output?: unknown;
  /** Extra ref scope (`draft`, `item`, `steps.*`, …). */
  scope?: Record<string, unknown>;
  /** Rule ids to evaluate (overrides step enforce default). */
  rules?: string[];
  /**
   * Expected overall pass (default true).
   * Per-rule expectations override when set.
   */
  expect?: {
    pass?: boolean;
    rules?: Record<string, boolean>;
  };
};

export type EvalFixturePack = {
  cases: EvalCase[];
};

export type CaseRuleResult = {
  ruleId: string;
  kind: SpecV2Rule["kind"];
  passed: boolean;
  expected?: boolean;
  ok: boolean;
  detail?: Record<string, unknown>;
};

export type CaseEvalResult = {
  caseId: string;
  passed: boolean;
  results: CaseRuleResult[];
  error?: string;
};

export type DryRunEvalResult = {
  ran: boolean;
  state?: string;
  passed: boolean;
  error?: string;
  evidenceCount?: number;
};

export type EvalReport = {
  compiled: CompiledEvalSuite;
  cases: CaseEvalResult[];
  dryRun?: DryRunEvalResult;
  /** True when every case matches expectations and optional dry-run succeeded. */
  passed: boolean;
  errors: string[];
};

export type RunEvalsOptions = {
  /** Spec body (preferred) or already-lowered workflow. */
  spec?: SpecV2Body;
  lowered?: LoweredWorkflow;
  fixtures: EvalFixturePack;
  /** Soft-rule judge (required when soft cases must pass under softFailClosed). */
  llmEngine?: ExecutionEngine;
  softFailClosed?: boolean;
  /**
   * When set with `lowered` (or derived), run a full dry workflow with
   * auto-approved HITL as an extra gate.
   */
  dryRun?: {
    engines: Record<string, ExecutionEngine>;
    context?: Partial<AgentContext>;
    softFailClosed?: boolean;
  };
};
