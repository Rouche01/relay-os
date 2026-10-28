/**
 * Spec v2 — ordered capability steps + goal-derived rules.
 *
 * Authoring format is YAML (see SPEC_V2_JSON_SCHEMA). This module is the
 * TypeScript shape and lifecycle helpers. Structural / capability / dataflow
 * checks live in @relay/spec-validator (follow-on).
 *
 * Spec v1 ({@link Spec}) remains for CommunityEngager dogfood. Spec v2 is
 * additive for generated HITL workflows.
 */

import type { CapabilityUseId } from "./engine-catalog";
import {
  freezeSpec,
  markSpecAborted,
  markSpecRunning,
  markSpecSatisfied,
  thawSpec,
  type SpecBudget,
  type SpecStatus,
} from "./spec";

/** `${steps.scout.output.posts}` / `${item.subreddit}` / `${rules.x.list}` */
export const SPEC_V2_REF_PATTERN = /^\$\{([a-zA-Z_][\w.]*)\}$/;

export type SpecV2Ref = `\${${string}}`;

export type SpecV2RuleKind = "hard" | "soft" | "outcome";

/**
 * Hard-rule evaluators (deterministic).
 * Values may be literals or Spec v2 refs (`${...}`).
 */
export type SpecV2HardCheck =
  | { in: unknown; list: unknown }
  | { notIn: unknown; list: unknown }
  | { matches: unknown; pattern: string }
  | { notMatches: unknown; pattern: string }
  | { eq: unknown; value: unknown }
  | { neq: unknown; value: unknown }
  | { gt: unknown; value: number }
  | { gte: unknown; value: number }
  | { lt: unknown; value: number }
  | { lte: unknown; value: number };

/** Soft-rule evaluator — LLM judge rubric. */
export type SpecV2SoftJudge = {
  rubric: string[];
  /** Pass when mean score ≥ this (1–5 scale by convention). */
  minMean?: number;
};

/**
 * Outcome-rule evaluator — measured after the run.
 * `after` is a duration like `48h`, `7d`, or milliseconds as a number string.
 */
export type SpecV2OutcomeMetric = {
  name: string;
  after: string;
  min?: number;
  max?: number;
};

export type SpecV2RuleBase = {
  id: string;
  description?: string;
};

export type SpecV2HardRule = SpecV2RuleBase & {
  kind: "hard";
  check: SpecV2HardCheck;
};

export type SpecV2SoftRule = SpecV2RuleBase & {
  kind: "soft";
  judge: SpecV2SoftJudge;
};

export type SpecV2OutcomeRule = SpecV2RuleBase & {
  kind: "outcome";
  metric: SpecV2OutcomeMetric;
};

export type SpecV2Rule = SpecV2HardRule | SpecV2SoftRule | SpecV2OutcomeRule;

/**
 * Optional downgrade of derived side-effect class (strictest by default).
 * Validator surfaces these; human confirms at freeze.
 */
export type SpecV2SideEffectDowngrade = {
  to: "none" | "reversible";
  reason: string;
};

/**
 * One ordered step. `use` must be a catalog capability id (`engine.verb`).
 * `forEach` fans out over a list ref (bounded by budget.maxJobs at runtime).
 * `enforce` lists rule ids checked against this step's output (fail closed).
 */
export type SpecV2Step = {
  id: string;
  use: CapabilityUseId | string;
  args?: Record<string, unknown>;
  forEach?: string;
  enforce?: string[];
  /**
   * Declared output field names this step produces (documentation /
   * dataflow hints). Runtime still records full output under
   * `steps.<id>.output`.
   */
  outputs?: string[];
  sideEffectDowngrade?: SpecV2SideEffectDowngrade;
};

/**
 * YAML / authoring body — no lifecycle metadata.
 * Connection refs never contain secrets (`reddit:default`).
 * Service refs name descriptors (`reddit-public`).
 */
export type SpecV2Body = {
  goal: string;
  connections?: string[];
  services?: string[];
  budget?: SpecBudget;
  rules?: SpecV2Rule[];
  steps: SpecV2Step[];
};

/**
 * Persisted Spec v2 with freeze lifecycle (same statuses as Spec v1).
 * `procedure` is optional — generated workflows use the generic interpreter.
 */
export type SpecV2 = SpecV2Body & {
  id: string;
  version: number;
  status: SpecStatus;
  intentId?: string;
  createdAt: string;
  frozenAt?: string;
  frozenBy?: string;
  contentHash?: string;
  /** Optional link to a legacy app entrypoint when dual-running. */
  procedure?: { appId: string; entrypoint: string };
};

export type CreateDraftSpecV2Input = SpecV2Body & {
  id?: string;
  intentId?: string;
  createdAt?: string;
  procedure?: SpecV2["procedure"];
};

function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** True when `value` is a single Spec v2 ref string. */
export function isSpecV2Ref(value: unknown): value is SpecV2Ref {
  return typeof value === "string" && SPEC_V2_REF_PATTERN.test(value);
}

/** Path inside `${...}` without braces, or undefined if not a ref. */
export function parseSpecV2Ref(value: string): string | undefined {
  const m = SPEC_V2_REF_PATTERN.exec(value.trim());
  return m?.[1];
}

/**
 * Collect every `${...}` ref path in a JSON-compatible tree (depth-first).
 * Used by the validator for dataflow checks.
 */
export function collectSpecV2Refs(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") {
    const path = parseSpecV2Ref(node);
    if (path) out.push(path);
    else {
      // Allow embedded refs later; for v0 only whole-string refs count.
    }
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectSpecV2Refs(item, out);
    return out;
  }
  if (node && typeof node === "object") {
    for (const v of Object.values(node as Record<string, unknown>)) {
      collectSpecV2Refs(v, out);
    }
  }
  return out;
}

function assertBodyBasics(body: SpecV2Body): void {
  const goal = body.goal?.trim();
  if (!goal) {
    throw new Error("Spec v2 goal must be non-empty");
  }
  if (!Array.isArray(body.steps) || body.steps.length === 0) {
    throw new Error("Spec v2 requires at least one step");
  }
  const stepIds = new Set<string>();
  for (const step of body.steps) {
    if (!step?.id?.trim()) {
      throw new Error("Spec v2 step id must be non-empty");
    }
    if (stepIds.has(step.id)) {
      throw new Error(`Duplicate Spec v2 step id ${JSON.stringify(step.id)}`);
    }
    stepIds.add(step.id);
    if (!step.use?.trim()) {
      throw new Error(`Spec v2 step ${JSON.stringify(step.id)} requires use`);
    }
  }
  const ruleIds = new Set<string>();
  for (const rule of body.rules ?? []) {
    if (!rule?.id?.trim()) {
      throw new Error("Spec v2 rule id must be non-empty");
    }
    if (ruleIds.has(rule.id)) {
      throw new Error(`Duplicate Spec v2 rule id ${JSON.stringify(rule.id)}`);
    }
    ruleIds.add(rule.id);
  }
}

/** Create a draft Spec v2 ready for human freeze. */
export function createDraftSpecV2(input: CreateDraftSpecV2Input): SpecV2 {
  assertBodyBasics(input);
  return {
    id: input.id ?? newId("specv2"),
    version: 1,
    status: "draft",
    intentId: input.intentId,
    goal: input.goal.trim(),
    connections: input.connections ? [...input.connections] : undefined,
    services: input.services ? [...input.services] : undefined,
    budget: input.budget ? { ...input.budget } : { dryRun: true },
    rules: input.rules ? structuredClone(input.rules) : [],
    steps: structuredClone(input.steps),
    procedure: input.procedure,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

/**
 * Light shape check for a parsed YAML/JSON object (not full schema validation).
 * Returns structured issues; does not throw.
 */
export function checkSpecV2BodyShape(
  value: unknown
): { ok: true; body: SpecV2Body } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: ["Spec v2 body must be an object"] };
  }
  const o = value as Record<string, unknown>;
  if (typeof o.goal !== "string" || !o.goal.trim()) {
    errors.push("goal must be a non-empty string");
  }
  if (!Array.isArray(o.steps) || o.steps.length === 0) {
    errors.push("steps must be a non-empty array");
  } else {
    const ids = new Set<string>();
    o.steps.forEach((step, i) => {
      if (!step || typeof step !== "object" || Array.isArray(step)) {
        errors.push(`steps[${i}] must be an object`);
        return;
      }
      const s = step as Record<string, unknown>;
      if (typeof s.id !== "string" || !s.id.trim()) {
        errors.push(`steps[${i}].id must be a non-empty string`);
      } else if (ids.has(s.id)) {
        errors.push(`duplicate step id ${JSON.stringify(s.id)}`);
      } else {
        ids.add(s.id);
      }
      if (typeof s.use !== "string" || !s.use.trim()) {
        errors.push(`steps[${i}].use must be a non-empty string`);
      }
    });
  }
  if (o.rules !== undefined) {
    if (!Array.isArray(o.rules)) {
      errors.push("rules must be an array when present");
    } else {
      const ids = new Set<string>();
      o.rules.forEach((rule, i) => {
        if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
          errors.push(`rules[${i}] must be an object`);
          return;
        }
        const r = rule as Record<string, unknown>;
        if (typeof r.id !== "string" || !r.id.trim()) {
          errors.push(`rules[${i}].id must be a non-empty string`);
        } else if (ids.has(r.id)) {
          errors.push(`duplicate rule id ${JSON.stringify(r.id)}`);
        } else {
          ids.add(r.id);
        }
        if (r.kind !== "hard" && r.kind !== "soft" && r.kind !== "outcome") {
          errors.push(
            `rules[${i}].kind must be hard | soft | outcome (got ${JSON.stringify(r.kind)})`
          );
        }
      });
    }
  }
  if (o.connections !== undefined && !Array.isArray(o.connections)) {
    errors.push("connections must be an array when present");
  }
  if (o.services !== undefined && !Array.isArray(o.services)) {
    errors.push("services must be an array when present");
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, body: value as SpecV2Body };
}

/** Freeze a draft Spec v2. Requires ≥1 rule or ≥1 step with enforce (soft gate). */
export function freezeSpecV2(
  spec: SpecV2,
  opts?: { frozenBy?: string; contentHash?: string; requireRules?: boolean }
): SpecV2 {
  const requireRules = opts?.requireRules ?? false;
  if (requireRules && (spec.rules?.length ?? 0) === 0) {
    throw new Error("Cannot freeze Spec v2 with empty rules (requireRules)");
  }
  // Reuse v1 freeze on a shim for status transition rules.
  const shim = {
    id: spec.id,
    version: spec.version,
    status: spec.status,
    goal: spec.goal,
    constraints: [],
    allowedActions: [],
    acceptance: [{ id: "steps", description: "Ordered steps present", kind: "gate" as const }],
    hitlRequired: [],
    budget: spec.budget ?? {},
    actionBinding: "protocol" as const,
    procedure: spec.procedure ?? { appId: "relay", entrypoint: "compose" },
    createdAt: spec.createdAt,
    contentHash: spec.contentHash,
  };
  const frozen = freezeSpec(shim, {
    frozenBy: opts?.frozenBy,
    contentHash: opts?.contentHash,
    requireAcceptance: true,
  });
  return {
    ...spec,
    status: frozen.status,
    frozenAt: frozen.frozenAt,
    frozenBy: frozen.frozenBy,
    contentHash: frozen.contentHash,
  };
}

export function thawSpecV2(spec: SpecV2): SpecV2 {
  const thawed = thawSpec({
    id: spec.id,
    version: spec.version,
    status: spec.status,
    goal: spec.goal,
    constraints: [],
    allowedActions: [],
    acceptance: [],
    hitlRequired: [],
    budget: spec.budget ?? {},
    actionBinding: "protocol",
    procedure: spec.procedure ?? { appId: "relay", entrypoint: "compose" },
    createdAt: spec.createdAt,
    frozenAt: spec.frozenAt,
    frozenBy: spec.frozenBy,
    contentHash: spec.contentHash,
  });
  return {
    ...spec,
    status: thawed.status,
    version: thawed.version,
    frozenAt: undefined,
    frozenBy: undefined,
    contentHash: undefined,
  };
}

export function markSpecV2Running(spec: SpecV2): SpecV2 {
  const next = markSpecRunning({
    id: spec.id,
    version: spec.version,
    status: spec.status,
    goal: spec.goal,
    constraints: [],
    allowedActions: [],
    acceptance: [],
    hitlRequired: [],
    budget: spec.budget ?? {},
    actionBinding: "protocol",
    procedure: spec.procedure ?? { appId: "relay", entrypoint: "compose" },
    createdAt: spec.createdAt,
  });
  return { ...spec, status: next.status };
}

export function markSpecV2Satisfied(spec: SpecV2): SpecV2 {
  const next = markSpecSatisfied({
    id: spec.id,
    version: spec.version,
    status: spec.status,
    goal: spec.goal,
    constraints: [],
    allowedActions: [],
    acceptance: [],
    hitlRequired: [],
    budget: spec.budget ?? {},
    actionBinding: "protocol",
    procedure: spec.procedure ?? { appId: "relay", entrypoint: "compose" },
    createdAt: spec.createdAt,
  });
  return { ...spec, status: next.status };
}

export function markSpecV2Aborted(spec: SpecV2): SpecV2 {
  const next = markSpecAborted({
    id: spec.id,
    version: spec.version,
    status: spec.status,
    goal: spec.goal,
    constraints: [],
    allowedActions: [],
    acceptance: [],
    hitlRequired: [],
    budget: spec.budget ?? {},
    actionBinding: "protocol",
    procedure: spec.procedure ?? { appId: "relay", entrypoint: "compose" },
    createdAt: spec.createdAt,
  });
  return { ...spec, status: next.status };
}

/** Authoring body only (for YAML dump / schema validate). */
export function toSpecV2Body(spec: SpecV2): SpecV2Body {
  return {
    goal: spec.goal,
    connections: spec.connections,
    services: spec.services,
    budget: spec.budget,
    rules: spec.rules,
    steps: spec.steps,
  };
}
