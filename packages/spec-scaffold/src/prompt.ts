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
    "- Do NOT invent service ids or operations missing from ## Services — the host will report a capability gap instead.",
    "- Optional Spec v2.1 trigger: exactly one of { manual: true } | { schedule: { cron } } | { poll: { everyMs, sourceStep } }.",
    "- Spec v2.1 once: \"${item.id}\" (or similar) on steps that must not re-run for the same key across schedule ticks. REQUIRED on irreversible forEach steps when trigger is schedule/poll.",
    "- Spec v2.1 when: whole-string \"${...}\" ref (truthy) or { eq|ne|in|exists } — false skips the step with evidence. No general expressions.",
    "- Spec v2.1 retry: { max } total attempts, optional backoffMs. onError: fail | skip_item | escalate_human. Irreversible steps with retry.max > 1 REQUIRE once.",
    "- Spec v2.1 output schema: llm.generate/extract args.schema and step.outputs are enforced at runtime (mismatch fails closed).",
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
    "Use ONLY services/operations listed under ## Services. Prefer github triage shape when the intent is GitHub issues.",
    "",
    "## Shape example (adapt; do not copy blindly)",
    JSON.stringify(
      {
        goal: "Triage new bug issues in acme/widgets",
        connections: ["github:default"],
        services: ["github"],
        trigger: { schedule: { cron: "0 9 * * 1-5" } },
        budget: { maxJobs: 10, dryRun: true },
        rules: [
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
              service: "github",
              operation: "issuesListForRepo",
              connection: "github:default",
              params: {
                owner: "acme",
                repo: "widgets",
                labels: "bug",
                state: "open",
              },
            },
          },
          {
            id: "draft",
            use: "llm.generate",
            forEach: "${steps.scout.output.body}",
            args: {
              prompt: "Draft a short triage comment. No URLs. JSON text + issue_number.",
              input: "${item}",
              schema: {
                type: "object",
                properties: {
                  text: { type: "string" },
                  issue_number: { type: "number" },
                },
                required: ["text", "issue_number"],
              },
            },
            enforce: ["no_promo_links"],
          },
          {
            id: "approve",
            use: "human.approve",
            args: {
              show: "${steps.draft.output}",
              prompt: "Approve triage comments before post?",
            },
          },
          {
            id: "post",
            use: "api.request",
            forEach: "${steps.draft.output}",
            once: "${item.issue_number}",
            args: {
              service: "github",
              operation: "issuesCreateComment",
              connection: "github:default",
              method: "POST",
              params: {
                owner: "acme",
                repo: "widgets",
                issue_number: "${item.issue_number}",
                body: "${item.text}",
              },
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
