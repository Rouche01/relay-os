import type { LlmMessage } from "@relay/llm";
import {
  checkSpecV2BodyShape,
  type SpecV2Body,
} from "@relay/protocol";
import { generateEvalFixtures } from "@relay/spec-evals";
import {
  normalizeSpecV2HardChecks,
  validateSpecV2,
  type SpecV2ValidationIssue,
} from "@relay/spec-validator";
import { stringify as stringifyYaml } from "yaml";
import {
  buildDraftUserPrompt,
  buildRepairUserPrompt,
  buildSystemPrompt,
} from "./prompt.js";
import {
  errorsIncludeCapabilityGap,
  formatNeedsMessage,
  needsFromIntent,
  needsFromValidationIssues,
} from "./needs.js";
import { SCAFFOLD_SPEC_JSON_SCHEMA } from "./schema.js";
import type {
  ScaffoldAttempt,
  ScaffoldResult,
  ScaffoldSpecOptions,
} from "./types.js";

const DEFAULT_MAX_REPAIRS = 3;

/**
 * Intent → Spec v2 draft via LLM, with validator repair loop (max 3 repairs).
 * Capability gaps (`needs`) abort before burning repairs — operator must
 * import a descriptor or add a connection first.
 */
export async function scaffoldSpec(
  options: ScaffoldSpecOptions
): Promise<ScaffoldResult> {
  const intent = options.intent?.trim();
  if (!intent) {
    return {
      ok: false,
      attempts: 0,
      errors: [
        {
          severity: "error",
          code: "empty_intent",
          message: "Intent must be non-empty",
        },
      ],
      history: [],
      message: "Intent must be non-empty",
    };
  }

  const services = options.services ?? [];
  const maxRepairs = options.maxRepairs ?? DEFAULT_MAX_REPAIRS;
  const maxAttempts = 1 + Math.max(0, maxRepairs);
  const temperature = options.temperature ?? 0.2;

  if (options.preflightNeeds !== false) {
    const preflight = needsFromIntent(
      intent,
      services,
      options.knownConnections
    );
    if (preflight.length) {
      return {
        ok: false,
        attempts: 0,
        errors: preflight.map((n) => ({
          severity: "error" as const,
          code: `needs_${n.kind}`,
          message: n.reason,
        })),
        history: [],
        needs: preflight,
        message: formatNeedsMessage(preflight),
      };
    }
  }

  const validateOpts = {
    services,
    knownConnections: options.knownConnections,
    ...options.validate,
  };

  const system = buildSystemPrompt({
    services,
    knownConnections: options.knownConnections,
  });

  const history: ScaffoldAttempt[] = [];
  let lastBody: SpecV2Body | undefined;
  let lastErrors: SpecV2ValidationIssue[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const kind = attempt === 1 ? "draft" : "repair";
    const user =
      kind === "draft"
        ? buildDraftUserPrompt(intent)
        : buildRepairUserPrompt({
            intent,
            previous: lastBody!,
            errors: lastErrors,
          });

    const messages: LlmMessage[] = [
      { role: "system", content: system },
      { role: "user", content: user },
    ];

    let raw: string;
    try {
      const result = await options.client.completeJson({
        messages,
        schema: SCAFFOLD_SPEC_JSON_SCHEMA,
        temperature,
      });
      raw = result.text;
    } catch (err) {
      const parseError = err instanceof Error ? err.message : String(err);
      history.push({ attempt, kind, parseError });
      return {
        ok: false,
        attempts: attempt,
        lastBody,
        yaml: lastBody ? specBodyToYaml(lastBody) : undefined,
        errors: lastErrors.length
          ? lastErrors
          : [
              {
                severity: "error",
                code: "llm_failed",
                message: parseError,
              },
            ],
        history,
        message: `LLM call failed on attempt ${attempt}: ${parseError}`,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (err) {
      const parseError = `Invalid JSON from model: ${
        err instanceof Error ? err.message : String(err)
      }`;
      history.push({ attempt, kind, parseError });
      lastErrors = [
        { severity: "error", code: "invalid_json", message: parseError },
      ];
      continue;
    }

    const shape = checkSpecV2BodyShape(parsed);
    if (!shape.ok) {
      const parseError = shape.errors.join("; ");
      history.push({ attempt, kind, parseError });
      lastErrors = shape.errors.map((message) => ({
        severity: "error" as const,
        code: "shape",
        message,
      }));
      continue;
    }

    const body = normalizeSpecV2HardChecks(shape.body);
    lastBody = body;
    const validation = validateSpecV2(body, validateOpts);
    history.push({ attempt, kind, body, validation });

    if (validation.ok) {
      const evals = generateEvalFixtures(body);
      return {
        ok: true,
        body,
        yaml: specBodyToYaml(body),
        attempts: attempt,
        validation,
        history,
        evals,
      };
    }

    lastErrors = validation.errors;

    // Do not burn repairs inventing missing services/connections/ops.
    if (errorsIncludeCapabilityGap(lastErrors)) {
      const needs = needsFromValidationIssues(lastErrors);
      return {
        ok: false,
        attempts: attempt,
        lastBody,
        yaml: lastBody ? specBodyToYaml(lastBody) : undefined,
        errors: lastErrors,
        history,
        needs,
        message: formatNeedsMessage(needs),
      };
    }
  }

  return {
    ok: false,
    attempts: history.length,
    lastBody,
    yaml: lastBody ? specBodyToYaml(lastBody) : undefined,
    errors: lastErrors,
    history,
    message: `Spec still invalid after ${history.length} attempt(s) (maxRepairs=${maxRepairs}). Fix the errors below or edit manually.`,
  };
}

/** Stable YAML dump for Desk / files. */
export function specBodyToYaml(body: SpecV2Body): string {
  return stringifyYaml(body, {
    lineWidth: 100,
    defaultStringType: "PLAIN",
    defaultKeyType: "PLAIN",
  }).trimEnd() + "\n";
}
