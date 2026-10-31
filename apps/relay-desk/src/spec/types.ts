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

/** Capability gap from `@relay/spec-scaffold` — import descriptor / add connection. */
export type ScaffoldNeed = {
  kind: "service" | "connection" | "operation";
  id: string;
  reason: string;
  action: "import_descriptor" | "add_connection" | "expand_operations";
};

export type ScaffoldResponse = {
  ok: boolean;
  status?: number;
  mode?: "stub" | "llm" | "needs";
  body?: Record<string, unknown>;
  yaml?: string;
  validation?: SpecValidationResult;
  attempts?: number;
  error?: string;
  errors?: SpecValidationIssue[];
  note?: string;
  /** When set, scaffold stopped for missing catalog reach — do not burn repairs. */
  needs?: ScaffoldNeed[];
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

export type SimulatedWrite = {
  stepId?: string;
  source?: "stepOutput" | "evidence";
  detail?: unknown;
};

export type EvidenceApproval = {
  approvedAt: string;
  approvedBy?: string;
  note?: string;
};

export type OutcomeFollowUp = {
  ruleId: string;
  metricName: string;
  after: string;
  dueAt: string;
  status: "pending" | "complete" | "failed" | "skipped";
  min?: number;
  max?: number;
  result?: {
    measuredAt: string;
    value?: number;
    passed?: boolean;
    detail?: unknown;
  };
};

export type RunResponse = {
  ok: boolean;
  error?: string;
  code?: string;
  state?: string;
  runId?: string;
  specId?: string;
  specHash?: string;
  mode?: "fixture" | "shadow" | "live";
  evidenceCount?: number;
  simulatedWriteCount?: number;
  simulatedWrites?: SimulatedWrite[];
  evidenceApproval?: EvidenceApproval;
  outcomeFollowUps?: OutcomeFollowUp[];
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

export type ApproveEvidenceResponse = {
  ok: boolean;
  error?: string;
  code?: string;
  runId?: string;
  specHash?: string;
  evidenceApproval?: EvidenceApproval;
  note?: string;
};

export type EnableScheduleResponse = {
  ok: boolean;
  error?: string;
  code?: string;
  enabled?: boolean;
  specHash?: string;
  approvedRunId?: string;
  evidenceApproval?: EvidenceApproval;
  note?: string;
  schedules?: Array<{
    id: string;
    entrypoint: string;
    cron?: string;
    every_ms?: number;
    enabled: boolean;
  }>;
};

export const DEFAULT_CE_INTENT = `Help people in allowlisted fashion subreddits (r/malefashionadvice, r/femalefashionadvice) with genuinely useful replies.

No promo links. Human approval before any comment. Prefer dry-run. Bound fan-out with a small maxJobs budget.`;

export type IntentPresetId = "ce-fashion" | "freight-wedge" | "blank";

export type IntentPreset = {
  id: IntentPresetId;
  label: string;
  intent: string;
};

/** Desk Intent library — presets only set text; they do not auto-scaffold. */
export const INTENT_PRESETS: readonly IntentPreset[] = [
  {
    id: "ce-fashion",
    label: "CE fashion",
    intent: DEFAULT_CE_INTENT,
  },
  {
    id: "freight-wedge",
    label: "Freight wedge",
    intent: `Help a freight broker work carrier-facing portals: find matching loads, draft outreach, and never commit capacity without a human.

Hard rules: only allowlisted brokers/shippers; no fake MC/DOT claims; human approve before any irreversible portal write or email send. Prefer dry-run. Bound fan-out with a small maxJobs budget.`,
  },
  {
    id: "blank",
    label: "Blank",
    intent: "",
  },
];
