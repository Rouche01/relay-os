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

export type SpecActionId =
  | "scaffold"
  | "validate"
  | "evals"
  | "lower"
  | "freeze"
  | "run";

export type SpecActionGate = {
  enabled: boolean;
  /** Shown when disabled (or when force is the only unlock). */
  reason?: string;
};

/**
 * Action enablement for Spec CTAs.
 * `force` unlocks lower / freeze / run when evals have not passed.
 */
export function gateSpecAction(
  action: SpecActionId,
  input: SpecPipelineInput & { busy: boolean; force?: boolean }
): SpecActionGate {
  if (input.busy) {
    return { enabled: false, reason: "blocked · busy" };
  }

  const hasIntent = input.intent.trim().length > 0;
  const hasYaml = input.yaml.trim().length > 0;
  const validated = input.validation?.ok === true;
  const evalsPassed =
    input.evals?.ok === true || input.evals?.report?.passed === true;
  const force = input.force === true;

  switch (action) {
    case "scaffold":
      if (!hasIntent) return { enabled: false, reason: "blocked · intent empty" };
      return { enabled: true };
    case "validate":
      if (!hasYaml) return { enabled: false, reason: "blocked · scaffold YAML first" };
      return { enabled: true };
    case "evals":
      if (!hasYaml) return { enabled: false, reason: "blocked · scaffold YAML first" };
      if (!validated) {
        return { enabled: false, reason: "blocked · validate must pass" };
      }
      return { enabled: true };
    case "lower":
    case "freeze":
    case "run": {
      if (!hasYaml) return { enabled: false, reason: "blocked · scaffold YAML first" };
      if (evalsPassed) return { enabled: true };
      if (force) {
        return {
          enabled: true,
          reason: "force · evals not passed",
        };
      }
      return { enabled: false, reason: "blocked · evals not passed" };
    }
  }
}
