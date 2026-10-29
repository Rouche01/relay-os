export type SpecValidationIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  path?: string;
  invariant?: string;
  stepId?: string;
  ruleId?: string;
};

export type SpecValidationResult = {
  ok: boolean;
  errors: SpecValidationIssue[];
  warnings: SpecValidationIssue[];
  durationMs?: number;
};

export type ScaffoldResponse = {
  ok: boolean;
  status?: number;
  mode?: "stub" | "llm";
  body?: Record<string, unknown>;
  yaml?: string;
  validation?: SpecValidationResult;
  attempts?: number;
  error?: string;
  errors?: SpecValidationIssue[];
  note?: string;
};

export type ValidateResponse = {
  ok: boolean;
  yaml?: string;
  body?: Record<string, unknown>;
  validation: SpecValidationResult;
};

export type LowerResponse = {
  ok: boolean;
  error?: string;
  validation?: SpecValidationResult;
  specHash?: string;
  manifest?: Record<string, unknown>;
  relay?: Record<string, unknown>;
  yaml?: string;
};

export type EvalsResponse = {
  ok: boolean;
  error?: string;
  compiled?: {
    goal: string;
    evals: Array<{ ruleId: string; kind: string; enforcedBy: string[] }>;
    outcomes?: unknown[];
    uncovered?: string[];
  };
  report?: {
    passed: boolean;
    errors: string[];
    cases: Array<{
      caseId: string;
      passed: boolean;
      error?: string;
      results?: Array<{
        ruleId: string;
        passed: boolean;
        expected?: boolean;
        ok: boolean;
      }>;
    }>;
  };
};

export type FreezeResponse = {
  ok: boolean;
  error?: string;
  validation?: SpecValidationResult;
  spec?: { id: string; status: string; version: number; goal: string };
  yaml?: string;
};

export type RunResponse = {
  ok: boolean;
  error?: string;
  state?: string;
  specId?: string;
  specHash?: string;
  evidenceCount?: number;
  note?: string;
  validation?: SpecValidationResult;
  /** Dry-run step outputs keyed by Spec step id. */
  stepOutputs?: Record<string, unknown>;
  stageResults?: Record<string, unknown>;
  evidence?: Array<{
    at?: string;
    stepId?: string;
    kind?: string;
    detail?: unknown;
  }>;
};

export const DEFAULT_CE_INTENT = `Help people in allowlisted fashion subreddits (r/malefashionadvice, r/femalefashionadvice) with genuinely useful replies.

No promo links. Human approval before any comment. Prefer dry-run. Bound fan-out with a small maxJobs budget.`;
