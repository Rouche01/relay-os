import {
  isSpecV2Ref,
  parseSpecV2Ref,
  type AgentContext,
  type SpecV2Rule,
} from "@relay/protocol";
import type { RelayStepsBlock } from "@relay/spec-lower";
import type { WorkflowStepsBag } from "./types.js";

/** Scope used to resolve `${...}` refs in args and hard checks. */
export type RefScope = Record<string, unknown>;

/**
 * Build a ref scope from AgentContext + relay metadata.
 * Step outputs live under `steps.<id>.output` and also as top-level `<id>`.
 */
export function buildRefScope(
  ctx: AgentContext,
  relay: RelayStepsBlock
): RefScope {
  const steps = (ctx.steps as WorkflowStepsBag | undefined) ?? {};
  const rules: Record<string, SpecV2Rule> = {};
  for (const r of relay.rules) {
    rules[r.id] = r;
  }

  const scope: RefScope = {
    steps,
    item: ctx.item,
    rules,
    budget: relay.budget,
    goal: relay.goal,
    connections: relay.connections,
    services: relay.services,
  };

  for (const [id, bag] of Object.entries(steps)) {
    scope[id] = bag.output;
  }

  return scope;
}

/** Read a dotted path from a root object. */
export function getByPath(root: unknown, path: string): unknown {
  if (!path) return root;
  const parts = path.split(".");
  let cur: unknown = root;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** Resolve a single ref path against a scope. */
export function lookupRef(path: string, scope: RefScope): unknown {
  return getByPath(scope, path);
}

/**
 * Deep-resolve Spec v2 refs in a JSON-compatible tree.
 * Only whole-string `${...}` values are substituted (same as validator v0).
 */
export function resolveRefs(value: unknown, scope: RefScope): unknown {
  if (typeof value === "string") {
    if (isSpecV2Ref(value)) {
      const path = parseSpecV2Ref(value);
      if (!path) return value;
      return lookupRef(path, scope);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolveRefs(v, scope));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveRefs(v, scope);
    }
    return out;
  }
  return value;
}
