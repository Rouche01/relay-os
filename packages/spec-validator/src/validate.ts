/**
 * Spec v2 validator — structural, capability, dataflow, service, safety,
 * rule coverage. Target &lt; 50ms for a ~50-step Spec.
 */

import {
  CATALOG_INVARIANTS,
  capabilityNeedsHitl,
  checkOperationParams,
  checkSpecV2BodyShape,
  collectSpecV2Refs,
  getCapability,
  getServiceOperation,
  indexServiceDescriptors,
  isSpecV2Ref,
  parseCapabilityUse,
  parseSpecV2Ref,
  resolveCapabilitySideEffect,
  type ServiceDescriptor,
  type SpecV2Body,
  type SpecV2Rule,
  type SpecV2Step,
} from "@relay/protocol";

import type {
  SpecV2InvariantId,
  SpecV2ValidationIssue,
  SpecV2ValidationResult,
} from "./types.js";

export type ValidateSpecV2Options = {
  /** Service descriptors available to this Spec (by id). */
  services?: readonly ServiceDescriptor[];
  /**
   * Connection ids the operator has configured (optional).
   * When set, Spec.connections and api.request connection args must be ⊆ this set.
   */
  knownConnections?: readonly string[];
  /** Treat missing budget.dryRun as error (default: warning only). */
  requireDryRunDefault?: boolean;
};

type Ctx = {
  issues: SpecV2ValidationIssue[];
  body: SpecV2Body;
  stepIndex: Map<string, number>;
  ruleById: Map<string, SpecV2Rule>;
  services: Map<string, ServiceDescriptor>;
  knownConnections?: Set<string>;
};

function err(
  ctx: Ctx,
  issue: Omit<SpecV2ValidationIssue, "severity"> & {
    severity?: SpecV2ValidationIssue["severity"];
  }
): void {
  ctx.issues.push({
    severity: issue.severity ?? "error",
    code: issue.code,
    message: issue.message,
    path: issue.path,
    invariant: issue.invariant,
    stepId: issue.stepId,
    ruleId: issue.ruleId,
  });
}

function checkStructure(ctx: Ctx): void {
  const shape = checkSpecV2BodyShape(ctx.body);
  if (!shape.ok) {
    for (const message of shape.errors) {
      err(ctx, {
        code: "structure",
        message,
        invariant: "inv_structure",
      });
    }
    return;
  }

  // forEach must look like a list-producing ref (whole-string ${...})
  ctx.body.steps.forEach((step, i) => {
    if (step.forEach === undefined) return;
    if (!isSpecV2Ref(step.forEach)) {
      err(ctx, {
        code: "foreach_not_ref",
        message: `steps[${i}].forEach must be a \${...} ref (got ${JSON.stringify(step.forEach)})`,
        path: `steps/${i}/forEach`,
        stepId: step.id,
        invariant: "inv_structure",
      });
    }
  });

  // Budget: maxJobs bounds forEach (inv_budget_bounds_loops)
  const hasForEach = ctx.body.steps.some((s) => s.forEach);
  const maxJobs = ctx.body.budget?.maxJobs;
  if (hasForEach && (maxJobs === undefined || maxJobs < 1)) {
    err(ctx, {
      code: "budget_max_jobs_required",
      message:
        "Spec with forEach steps requires budget.maxJobs ≥ 1 (bounded loops)",
      path: "budget/maxJobs",
      invariant: "inv_budget_bounds_loops",
    });
  }

  if (ctx.body.budget?.dryRun === false) {
    err(ctx, {
      severity: "warning",
      code: "dry_run_disabled",
      message:
        "budget.dryRun is false — irreversible acts may commit; prefer dryRun until freeze review",
      path: "budget/dryRun",
    });
  } else if (ctx.body.budget?.dryRun === undefined) {
    err(ctx, {
      severity: "warning",
      code: "dry_run_default",
      message: "budget.dryRun omitted — interpreters should default to true",
      path: "budget/dryRun",
    });
  }
}

function checkCapabilities(ctx: Ctx): void {
  ctx.body.steps.forEach((step, i) => {
    const parsed = parseCapabilityUse(step.use);
    if (!parsed.ok) {
      err(ctx, {
        code: "unknown_capability",
        message: parsed.error,
        path: `steps/${i}/use`,
        stepId: step.id,
        invariant: "inv_no_unbound_capability",
      });
      return;
    }
    const cap = parsed.capability;
    // Required args present (literals or refs both count as present)
    const args = step.args ?? {};
    for (const [name, def] of Object.entries(cap.args)) {
      if (!def.required) continue;
      if (!(name in args) || args[name] === undefined || args[name] === null) {
        err(ctx, {
          code: "missing_capability_arg",
          message: `Step ${JSON.stringify(step.id)} missing required arg ${JSON.stringify(name)} for ${cap.id}`,
          path: `steps/${i}/args/${name}`,
          stepId: step.id,
          invariant: "inv_no_unbound_capability",
        });
      }
    }
    // Unknown arg keys → warning (forward-compat)
    for (const key of Object.keys(args)) {
      if (!(key in cap.args)) {
        err(ctx, {
          severity: "warning",
          code: "unknown_capability_arg",
          message: `Step ${JSON.stringify(step.id)} has undeclared arg ${JSON.stringify(key)} for ${cap.id}`,
          path: `steps/${i}/args/${key}`,
          stepId: step.id,
        });
      }
    }
  });
}

function checkDataflow(ctx: Ctx): void {
  ctx.body.steps.forEach((step, i) => {
    const refs = [
      ...collectSpecV2Refs(step.args),
      ...(step.forEach ? collectSpecV2Refs(step.forEach) : []),
    ];
    for (const path of refs) {
      validateRef(ctx, path, step, i);
    }
  });

  // Rule check/judge trees may also contain refs
  (ctx.body.rules ?? []).forEach((rule, i) => {
    const refs = collectSpecV2Refs(rule);
    for (const path of refs) {
      // item.* / draft.* are binding-time aliases — allowed in rules
      if (path.startsWith("item.") || path === "item") continue;
      if (path.startsWith("draft.") || path === "draft") continue;
      if (path.startsWith("rules.")) {
        const rest = path.slice("rules.".length);
        const ruleId = rest.split(".")[0];
        if (!ruleId || !ctx.ruleById.has(ruleId)) {
          err(ctx, {
            code: "unknown_rule_ref",
            message: `Unknown rule ref \${${path}}`,
            path: `rules/${i}`,
            ruleId: rule.id,
            invariant: "inv_dataflow_refs",
          });
        }
        continue;
      }
      if (path.startsWith("steps.")) {
        const stepId = path.split(".")[1];
        if (!stepId || !ctx.stepIndex.has(stepId)) {
          err(ctx, {
            code: "unknown_step_ref",
            message: `Unknown step ref \${${path}} in rule ${JSON.stringify(rule.id)}`,
            path: `rules/${i}`,
            ruleId: rule.id,
            invariant: "inv_dataflow_refs",
          });
        }
        continue;
      }
      // Other roots in rules: warn
      err(ctx, {
        severity: "warning",
        code: "unbound_rule_ref",
        message: `Rule ${JSON.stringify(rule.id)} ref \${${path}} is not steps.* / rules.* / item.* / draft.*`,
        path: `rules/${i}`,
        ruleId: rule.id,
      });
    }
  });
}

function validateRef(
  ctx: Ctx,
  path: string,
  step: SpecV2Step,
  stepIdx: number
): void {
  if (path.startsWith("item.") || path === "item") {
    if (!step.forEach) {
      err(ctx, {
        code: "item_ref_outside_foreach",
        message: `Step ${JSON.stringify(step.id)} uses \${${path}} but has no forEach`,
        path: `steps/${stepIdx}`,
        stepId: step.id,
        invariant: "inv_dataflow_refs",
      });
    }
    return;
  }
  if (path.startsWith("draft.") || path === "draft") {
    // Alias for current draft payload — allowed
    return;
  }
  if (path.startsWith("rules.")) {
    const ruleId = path.slice("rules.".length).split(".")[0];
    if (!ruleId || !ctx.ruleById.has(ruleId)) {
      err(ctx, {
        code: "unknown_rule_ref",
        message: `Step ${JSON.stringify(step.id)} refs unknown rule \${${path}}`,
        path: `steps/${stepIdx}`,
        stepId: step.id,
        invariant: "inv_dataflow_refs",
      });
    }
    return;
  }
  if (path.startsWith("steps.")) {
    const parts = path.split(".");
    const refStepId = parts[1];
    if (!refStepId || !ctx.stepIndex.has(refStepId)) {
      err(ctx, {
        code: "unknown_step_ref",
        message: `Step ${JSON.stringify(step.id)} refs unknown step \${${path}}`,
        path: `steps/${stepIdx}`,
        stepId: step.id,
        invariant: "inv_dataflow_refs",
      });
      return;
    }
    const refIdx = ctx.stepIndex.get(refStepId)!;
    if (refIdx >= stepIdx) {
      err(ctx, {
        code: "forward_step_ref",
        message: `Step ${JSON.stringify(step.id)} refs step ${JSON.stringify(refStepId)} at or after itself (no cycles / forward refs)`,
        path: `steps/${stepIdx}`,
        stepId: step.id,
        invariant: "inv_dataflow_refs",
      });
    }
    // forEach should typically point at *.output or *.output.*
    if (
      step.forEach &&
      parseSpecV2Ref(step.forEach) === path &&
      !path.includes(".output")
    ) {
      err(ctx, {
        severity: "warning",
        code: "foreach_not_output",
        message: `forEach \${${path}} does not reference .output — expected a list-producing step output`,
        path: `steps/${stepIdx}/forEach`,
        stepId: step.id,
      });
    }
    return;
  }
  err(ctx, {
    code: "unknown_ref_root",
    message: `Unrecognized ref root in \${${path}} (expected steps|rules|item|draft)`,
    path: `steps/${stepIdx}`,
    stepId: step.id,
    invariant: "inv_dataflow_refs",
  });
}

function checkServices(ctx: Ctx): void {
  const declared = new Set(ctx.body.services ?? []);

  ctx.body.steps.forEach((step, i) => {
    const cap = getCapability(step.use);
    if (!cap || cap.id !== "api.request") return;

    const args = step.args ?? {};
    const serviceId =
      typeof args.service === "string" ? args.service.trim() : "";
    const operationId =
      typeof args.operation === "string" ? args.operation.trim() : "";

    if (!serviceId) {
      // missing_capability_arg already covers required service
      return;
    }

    if (declared.size > 0 && !declared.has(serviceId)) {
      err(ctx, {
        code: "service_not_declared",
        message: `Step ${JSON.stringify(step.id)} uses service ${JSON.stringify(serviceId)} not listed in Spec.services`,
        path: `steps/${i}/args/service`,
        stepId: step.id,
        invariant: "inv_service_operation_bound",
      });
    }

    const desc = ctx.services.get(serviceId);
    if (!desc) {
      err(ctx, {
        code: "unknown_service",
        message: `Unknown service descriptor ${JSON.stringify(serviceId)}`,
        path: `steps/${i}/args/service`,
        stepId: step.id,
        invariant: "inv_service_operation_bound",
      });
      return;
    }

    if (!operationId) return;
    const op = getServiceOperation(desc, operationId);
    if (!op) {
      err(ctx, {
        code: "unknown_operation",
        message: `Service ${JSON.stringify(serviceId)} has no operation ${JSON.stringify(operationId)}`,
        path: `steps/${i}/args/operation`,
        stepId: step.id,
        invariant: "inv_service_operation_bound",
      });
      return;
    }

    // Method consistency with descriptor (inv_api_method_side_effect)
    const argMethod =
      typeof args.method === "string"
        ? args.method.trim().toUpperCase()
        : undefined;
    if (argMethod && argMethod !== op.method) {
      err(ctx, {
        code: "method_mismatch",
        message: `Step ${JSON.stringify(step.id)} method ${argMethod} ≠ descriptor ${op.method} for ${serviceId}.${operationId}`,
        path: `steps/${i}/args/method`,
        stepId: step.id,
        invariant: "inv_api_method_side_effect",
      });
    }

    const params =
      args.params && typeof args.params === "object" && !Array.isArray(args.params)
        ? (args.params as Record<string, unknown>)
        : undefined;
    // Skip required-param check when params contain only unresolved refs at top level
    // — still check keys that are required and entirely missing.
    const paramCheck = checkOperationParams(op, params);
    if (!paramCheck.ok) {
      // If params object is missing entirely but operation has required params → error
      if (!params) {
        for (const message of paramCheck.errors) {
          err(ctx, {
            code: "missing_operation_param",
            message: `Step ${JSON.stringify(step.id)}: ${message}`,
            path: `steps/${i}/args/params`,
            stepId: step.id,
            invariant: "inv_service_operation_bound",
          });
        }
      } else {
        for (const message of paramCheck.errors) {
          // Required param may be provided via a single ref object — only flag missing keys
          err(ctx, {
            code: "missing_operation_param",
            message: `Step ${JSON.stringify(step.id)}: ${message}`,
            path: `steps/${i}/args/params`,
            stepId: step.id,
            invariant: "inv_service_operation_bound",
          });
        }
      }
    }
  });

  // Declared services should exist when a catalog was provided
  if (ctx.services.size > 0) {
    for (const id of declared) {
      if (!ctx.services.has(id)) {
        err(ctx, {
          code: "declared_service_missing",
          message: `Spec.services lists ${JSON.stringify(id)} but no descriptor was provided`,
          path: "services",
          invariant: "inv_service_operation_bound",
        });
      }
    }
  }
}

function checkSafety(ctx: Ctx): void {
  let sawHuman = false;

  ctx.body.steps.forEach((step, i) => {
    const cap = getCapability(step.use);
    if (!cap) return; // unknown handled elsewhere

    if (cap.engine === "human") {
      sawHuman = true;
    }

    const args = step.args ?? {};
    let descriptorMethod: string | undefined;
    if (cap.id === "api.request" && typeof args.service === "string") {
      const desc = ctx.services.get(args.service);
      const opId =
        typeof args.operation === "string" ? args.operation : undefined;
      if (desc && opId) {
        descriptorMethod = getServiceOperation(desc, opId)?.method;
      }
    }

    let sideEffect = resolveCapabilitySideEffect(cap, {
      args,
      descriptorMethod,
    });

    if (step.sideEffectDowngrade) {
      if (!step.sideEffectDowngrade.reason?.trim()) {
        err(ctx, {
          code: "downgrade_missing_reason",
          message: `Step ${JSON.stringify(step.id)} sideEffectDowngrade requires a reason`,
          path: `steps/${i}/sideEffectDowngrade`,
          stepId: step.id,
        });
      } else {
        err(ctx, {
          severity: "warning",
          code: "side_effect_downgrade",
          message: `Step ${JSON.stringify(step.id)} downgrades side-effect to ${step.sideEffectDowngrade.to}: ${step.sideEffectDowngrade.reason}`,
          path: `steps/${i}/sideEffectDowngrade`,
          stepId: step.id,
        });
        sideEffect = step.sideEffectDowngrade.to;
      }
    }

    const needsHitl =
      capabilityNeedsHitl(cap, { args, descriptorMethod }) &&
      sideEffect === "irreversible";

    if (needsHitl && !sawHuman) {
      err(ctx, {
        code: "hitl_before_irreversible",
        message: `Irreversible step ${JSON.stringify(step.id)} (${cap.id}) has no preceding human.* step`,
        path: `steps/${i}`,
        stepId: step.id,
        invariant: "inv_hitl_before_irreversible",
      });
    }
  });
}

function checkRuleCoverage(ctx: Ctx): void {
  const enforced = new Set<string>();
  ctx.body.steps.forEach((step, i) => {
    for (const ruleId of step.enforce ?? []) {
      if (!ctx.ruleById.has(ruleId)) {
        err(ctx, {
          code: "unknown_enforce_rule",
          message: `Step ${JSON.stringify(step.id)} enforce refs unknown rule ${JSON.stringify(ruleId)}`,
          path: `steps/${i}/enforce`,
          stepId: step.id,
          ruleId,
          invariant: "inv_rule_coverage",
        });
      } else {
        enforced.add(ruleId);
      }
    }
  });

  for (const rule of ctx.body.rules ?? []) {
    // Evaluator presence (defensive — malformed objects may slip past TS)
    const raw = rule as SpecV2Rule & Record<string, unknown>;
    if (rule.kind === "hard" && raw.check === undefined) {
      err(ctx, {
        code: "rule_missing_evaluator",
        message: `Hard rule ${JSON.stringify(rule.id)} missing check`,
        ruleId: rule.id,
        invariant: "inv_rule_coverage",
      });
    }
    if (rule.kind === "soft" && raw.judge === undefined) {
      err(ctx, {
        code: "rule_missing_evaluator",
        message: `Soft rule ${JSON.stringify(rule.id)} missing judge`,
        ruleId: rule.id,
        invariant: "inv_rule_coverage",
      });
    }
    if (rule.kind === "outcome" && raw.metric === undefined) {
      err(ctx, {
        code: "rule_missing_evaluator",
        message: `Outcome rule ${JSON.stringify(rule.id)} missing metric`,
        ruleId: rule.id,
        invariant: "inv_rule_coverage",
      });
    }

    // hard/soft must be enforced somewhere; outcome is post-run
    if (rule.kind === "hard" || rule.kind === "soft") {
      if (!enforced.has(rule.id)) {
        err(ctx, {
          code: "rule_not_enforced",
          message: `${rule.kind} rule ${JSON.stringify(rule.id)} is not listed in any step.enforce`,
          ruleId: rule.id,
          invariant: "inv_rule_coverage",
        });
      }
    }
  }
}

function checkConnections(ctx: Ctx): void {
  const listed = ctx.body.connections ?? [];
  for (const c of listed) {
    if (typeof c !== "string" || !c.trim()) {
      err(ctx, {
        code: "empty_connection",
        message: "connections entries must be non-empty strings",
        path: "connections",
      });
      continue;
    }
    // Heuristic: reject values that look like secrets
    if (/^(sk-|ghp_|xox[baprs]-)/i.test(c) || c.length > 128) {
      err(ctx, {
        code: "connection_looks_like_secret",
        message: `Connection ref ${JSON.stringify(c.slice(0, 24))}… looks like a secret — use opaque refs only`,
        path: "connections",
      });
    }
    if (ctx.knownConnections && !ctx.knownConnections.has(c)) {
      err(ctx, {
        code: "unknown_connection",
        message: `Unknown connection ${JSON.stringify(c)}`,
        path: "connections",
      });
    }
  }

  ctx.body.steps.forEach((step, i) => {
    const cap = getCapability(step.use);
    if (!cap || cap.id !== "api.request") return;
    const conn = step.args?.connection;
    if (conn === undefined) return;
    if (typeof conn !== "string" || !conn.trim()) {
      err(ctx, {
        code: "empty_connection_arg",
        message: `Step ${JSON.stringify(step.id)} connection must be a non-empty string`,
        path: `steps/${i}/args/connection`,
        stepId: step.id,
      });
      return;
    }
    if (listed.length > 0 && !listed.includes(conn)) {
      err(ctx, {
        code: "connection_not_declared",
        message: `Step ${JSON.stringify(step.id)} connection ${JSON.stringify(conn)} not in Spec.connections`,
        path: `steps/${i}/args/connection`,
        stepId: step.id,
      });
    }
    if (ctx.knownConnections && !ctx.knownConnections.has(conn)) {
      err(ctx, {
        code: "unknown_connection",
        message: `Step ${JSON.stringify(step.id)} unknown connection ${JSON.stringify(conn)}`,
        path: `steps/${i}/args/connection`,
        stepId: step.id,
      });
    }
  });
}

/**
 * Validate a Spec v2 authoring body.
 * Does not throw — returns structured errors/warnings.
 */
export function validateSpecV2(
  body: SpecV2Body,
  options: ValidateSpecV2Options = {}
): SpecV2ValidationResult {
  const started = performance.now();
  const ctx: Ctx = {
    issues: [],
    body,
    stepIndex: new Map(body.steps.map((s, i) => [s.id, i])),
    ruleById: new Map((body.rules ?? []).map((r) => [r.id, r])),
    services: indexServiceDescriptors(options.services ?? []),
    knownConnections: options.knownConnections
      ? new Set(options.knownConnections)
      : undefined,
  };

  checkStructure(ctx);
  // If structure is fatally broken (no steps), still run what we can
  checkCapabilities(ctx);
  checkDataflow(ctx);
  checkServices(ctx);
  checkSafety(ctx);
  checkRuleCoverage(ctx);
  checkConnections(ctx);

  const errors = ctx.issues.filter((i) => i.severity === "error");
  const warnings = ctx.issues.filter((i) => i.severity === "warning");
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    durationMs: performance.now() - started,
  };
}

/** Re-export catalog invariant statements for UI / docs. */
export const SPEC_V2_VALIDATOR_INVARIANTS: Record<
  SpecV2InvariantId,
  string
> = {
  inv_no_unbound_capability: CATALOG_INVARIANTS.inv_no_unbound_capability,
  inv_hitl_before_irreversible: CATALOG_INVARIANTS.inv_hitl_before_irreversible,
  inv_api_method_side_effect: CATALOG_INVARIANTS.inv_api_method_side_effect,
  inv_budget_bounds_loops:
    "Every forEach is capped by budget.maxJobs (termination)",
  inv_rule_coverage:
    "Every hard/soft rule has an evaluator and appears in some step.enforce; outcome rules declare a metric",
  inv_service_operation_bound:
    "Every api.request service.operation exists in a provided service descriptor",
  inv_dataflow_refs:
    "Every ${...} ref resolves to an earlier step output, rule, item, or draft alias",
  inv_structure: "Spec v2 body is well-formed (goal, unique steps/rules, forEach refs)",
};
