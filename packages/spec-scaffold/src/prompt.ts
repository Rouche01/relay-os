import {
  ENGINE_CAPABILITY_CATALOG,
  type ServiceDescriptor,
  type SpecV2Body,
} from "@relay/protocol";
import type { SpecV2ValidationIssue } from "@relay/spec-validator";

/** Compact catalog for the scaffolder system prompt. */
export function formatCatalogForPrompt(): string {
  const lines = ENGINE_CAPABILITY_CATALOG.map((c) => {
    const req = Object.entries(c.args)
      .filter(([, a]) => a.required)
      .map(([k]) => k);
    const opt = Object.entries(c.args)
      .filter(([, a]) => !a.required)
      .map(([k]) => k);
    const args =
      req.length || opt.length
        ? ` args: required=[${req.join(",")}] optional=[${opt.join(",")}]`
        : "";
    return `- ${c.id}: ${c.description} (sideEffect=${c.defaultSideEffect}${
      c.requiresHitlWhenIrreversible ? "; HITL when irreversible" : ""
    })${args}`;
  });
  return ["## Engine capabilities (closed catalog)", ...lines].join("\n");
}

/** Compact service descriptors for the scaffolder system prompt. */
export function formatServicesForPrompt(
  services: readonly ServiceDescriptor[]
): string {
  if (!services.length) {
    return "## Services\n(none provided — avoid api.request or only use if the intent names a known service id)";
  }
  const blocks = services.map((s) => {
    const ops = s.operations
      .map((op) => {
        const params = (op.params ?? [])
          .map((p) => `${p.name}${p.required ? "*" : ""}:${p.in}`)
          .join(", ");
        return `  - ${op.id} ${op.method} ${op.path}${
          params ? ` (${params})` : ""
        }`;
      })
      .join("\n");
    return `### ${s.id}\nbaseUrl: ${s.baseUrl}\noperations:\n${ops}`;
  });
  return ["## Services (api.request must use these ids)", ...blocks].join(
    "\n\n"
  );
}

export function buildSystemPrompt(options: {
  services: readonly ServiceDescriptor[];
  knownConnections?: readonly string[];
}): string {
  const connections =
    options.knownConnections && options.knownConnections.length
      ? options.knownConnections.join(", ")
      : "(any non-secret ref like reddit:default)";

  return [
    "You author Relay Spec v2 JSON for HITL agent workflows.",
    "Output MUST match the JSON schema. Do not invent engine capabilities or API operations.",
    "",
    "Rules:",
    "- Derive hard/soft/outcome rules from the goal; every hard/soft rule must appear in some step.enforce.",
    "- budget.dryRun defaults to true; set maxJobs when any step uses forEach.",
    "- Every irreversible path (api POST/PUT/PATCH/DELETE, etc.) must pass through a human.approve|edit|choose step first.",
    "- Refs are whole-string only: \"${steps.scout.output.body.posts}\", \"${item.subreddit}\", \"${draft.text}\".",
    "- api.request results are under steps.<id>.output with HTTP payload at .body (e.g. posts list → ${steps.scout.output.body.posts}).",
    "- Connection refs never contain secrets.",
    `- Known connections: ${connections}`,
    "",
    formatCatalogForPrompt(),
    "",
    formatServicesForPrompt(options.services),
  ].join("\n");
}

export function buildDraftUserPrompt(intent: string): string {
  return [
    "Write a Spec v2 JSON body for this intent.",
    "Prefer a short linear pipeline with HITL before any write.",
    "",
    "## Intent",
    intent.trim(),
  ].join("\n");
}

export function buildRepairUserPrompt(options: {
  intent: string;
  previous: SpecV2Body;
  errors: SpecV2ValidationIssue[];
}): string {
  const errLines = options.errors.map((e) => {
    const loc = [e.path, e.stepId, e.ruleId, e.invariant]
      .filter(Boolean)
      .join(" ");
    return `- [${e.code}] ${e.message}${loc ? ` (${loc})` : ""}`;
  });
  return [
    "The previous Spec failed validation. Return a repaired Spec v2 JSON body.",
    "Fix every error. Do not invent capabilities or operations.",
    "",
    "## Intent",
    options.intent.trim(),
    "",
    "## Validator errors",
    ...errLines,
    "",
    "## Previous Spec JSON",
    JSON.stringify(options.previous, null, 2),
  ].join("\n");
}
