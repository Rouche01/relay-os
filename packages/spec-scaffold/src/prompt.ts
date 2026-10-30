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
    "- NEVER emit empty args {}. Fill every required capability arg (api.request needs service+operation; llm.generate needs prompt; human.approve|edit need show).",
    "- Refs are whole-string only: \"${steps.scout.output.body.posts}\", \"${item.subreddit}\", \"${draft.text}\".",
    "- Hard matches/notMatches ALWAYS need TWO fields: subject ref + pattern. NEVER put the regex alone in notMatches.",
    '  Correct: { "notMatches": "${draft.text}", "pattern": "https?://" }. Wrong: { "notMatches": "https?://" }.',
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
    "Populate args fully — empty {} fails validation.",
    "",
    "## Shape example (adapt; do not copy blindly)",
    JSON.stringify(
      {
        goal: "…",
        connections: ["reddit:default"],
        services: ["reddit-public", "reddit-oauth"],
        budget: { maxJobs: 2, dryRun: true },
        rules: [
          {
            id: "allowlist_only",
            kind: "hard",
            check: {
              in: "${item.subreddit}",
              list: ["malefashionadvice"],
            },
          },
          {
            id: "no_promo_links",
            kind: "hard",
            check: {
              notMatches: "${draft.text}",
              pattern: "https?://",
            },
          },
        ],
        steps: [
          {
            id: "scout",
            use: "api.request",
            args: {
              service: "reddit-public",
              operation: "listNew",
              params: { subreddit: "malefashionadvice", limit: 10 },
            },
          },
          {
            id: "draft",
            use: "llm.generate",
            forEach: "${steps.scout.output.body.posts}",
            args: {
              prompt: "Draft a helpful reply. No links.",
              input: "${item}",
            },
            enforce: ["allowlist_only", "no_promo_links"],
          },
          {
            id: "approve",
            use: "human.approve",
            args: {
              show: "${steps.draft.output}",
              prompt: "Approve before post?",
            },
          },
        ],
      },
      null,
      2
    ),
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
