import type { EvalsResponse, LowerResponse, RunResponse, SpecValidationResult } from "./types.ts";

export type SpecPipelineStepId =
  | "intent"
  | "scaffold"
  | "validate"
  | "evals"
  | "lower"
  | "freeze"
  | "run";

/** Visual state for the Spec pipeline stepper. */
export type SpecPipelineStepStatus = "done" | "current" | "blocked" | "error";

export type SpecPipelineStep = {
  id: SpecPipelineStepId;
  label: string;
  status: SpecPipelineStepStatus;
  /** DOM target: `[data-spec-step="…"]` */
  target: string;
};

export type SpecPipelineInput = {
  intent: string;
  yaml: string;
  validation?: SpecValidationResult;
  evals?: EvalsResponse;
  lowered?: LowerResponse;
  frozenId?: string;
  runResult?: RunResponse;
};

const STEPS: Array<{
  id: SpecPipelineStepId;
  label: string;
  target: string;
}> = [
  { id: "intent", label: "Intent", target: "intent" },
  { id: "scaffold", label: "Scaffold", target: "yaml" },
  { id: "validate", label: "Validate", target: "validate" },
  { id: "evals", label: "Evals", target: "evals" },
  { id: "lower", label: "Lower", target: "lower" },
  { id: "freeze", label: "Freeze", target: "freeze" },
  { id: "run", label: "Run", target: "freeze" },
];

function isDone(id: SpecPipelineStepId, s: SpecPipelineInput): boolean {
  switch (id) {
    case "intent":
      return s.intent.trim().length > 0;
    case "scaffold":
      return s.yaml.trim().length > 0;
    case "validate":
      return s.validation?.ok === true;
    case "evals":
      return s.evals?.ok === true || s.evals?.report?.passed === true;
    case "lower":
      return s.lowered?.ok === true;
    case "freeze":
      return Boolean(s.frozenId);
    case "run":
      return s.runResult?.ok === true;
  }
}

function isError(id: SpecPipelineStepId, s: SpecPipelineInput): boolean {
  switch (id) {
    case "intent":
    case "scaffold":
      return false;
    case "validate":
      return Boolean(s.validation && !s.validation.ok);
    case "evals":
      return Boolean(s.evals && !s.evals.ok && s.evals.report);
    case "lower":
      return Boolean(s.lowered && !s.lowered.ok);
    case "freeze":
      return false;
    case "run":
      return Boolean(s.runResult && !s.runResult.ok);
  }
}

/**
 * Derive stepper states: first incomplete (or error) step is `current`;
 * earlier successes are `done`; the rest are `blocked`.
 */
export function deriveSpecPipeline(input: SpecPipelineInput): SpecPipelineStep[] {
  let foundCurrent = false;
  return STEPS.map((meta) => {
    if (isDone(meta.id, input)) {
      return { ...meta, status: "done" as const };
    }
    if (isError(meta.id, input)) {
      if (!foundCurrent) {
        foundCurrent = true;
        return { ...meta, status: "error" as const };
      }
      return { ...meta, status: "blocked" as const };
    }
    if (!foundCurrent) {
      foundCurrent = true;
      return { ...meta, status: "current" as const };
    }
    return { ...meta, status: "blocked" as const };
  });
}

export function scrollToSpecStep(target: string): void {
  const el = document.querySelector(`[data-spec-step="${target}"]`);
  if (el instanceof HTMLElement) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}
