import type { SpecV2Body, SpecV2Rule } from "@relay/protocol";
import type { LoweredWorkflow } from "@relay/spec-lower";
import type { CompiledEval, CompiledEvalSuite } from "./types.js";

/**
 * Compile Spec v2 rules into an eval suite.
 * Hard/soft → offline checks; outcome → declared metric stubs.
 */
export function compileEvals(
  source: SpecV2Body | LoweredWorkflow
): CompiledEvalSuite {
  const body = isLowered(source) ? source.spec : source;
  const specHash = isLowered(source) ? source.specHash : undefined;
  const rules = body.rules ?? [];
  const enforceIndex = indexEnforce(body);

  const evals: CompiledEval[] = [];
  const outcomes: CompiledEval[] = [];
  const uncovered: string[] = [];

  for (const rule of rules) {
    const enforcedBy = enforceIndex.get(rule.id) ?? [];
    const compiled: CompiledEval = {
      ruleId: rule.id,
      kind: rule.kind,
      rule,
      enforcedBy,
    };
    evals.push(compiled);
    if (rule.kind === "outcome") {
      outcomes.push(compiled);
    } else if (enforcedBy.length === 0) {
      uncovered.push(rule.id);
    }
  }

  return {
    goal: body.goal,
    specHash,
    evals,
    uncovered,
    outcomes,
  };
}

function indexEnforce(body: SpecV2Body): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const step of body.steps) {
    for (const id of step.enforce ?? []) {
      const list = map.get(id) ?? [];
      list.push(step.id);
      map.set(id, list);
    }
  }
  return map;
}

function isLowered(source: SpecV2Body | LoweredWorkflow): source is LoweredWorkflow {
  return (
    typeof source === "object" &&
    source !== null &&
    "kind" in source &&
    (source as LoweredWorkflow).kind === "relay.spec.v2"
  );
}

/** Rules that participate in case / enforce evaluation (not outcome stubs). */
export function evaluableRules(rules: SpecV2Rule[]): SpecV2Rule[] {
  return rules.filter((r) => r.kind === "hard" || r.kind === "soft");
}
