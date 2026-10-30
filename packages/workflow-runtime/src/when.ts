/**
 * Spec v2.1 `when` evaluation — whole-ref truthiness or eq/ne/in/exists.
 * No general expression language.
 */

import {
  checkSpecV2WhenShape,
  type SpecV2When,
} from "@relay/protocol";
import { resolveRefs, type RefScope } from "./refs.js";

export type WhenEvalResult = {
  ok: boolean;
  detail: Record<string, unknown>;
};

/** Evaluate a shape-valid `when` against a ref scope. */
export function evaluateWhen(
  when: SpecV2When,
  scope: RefScope
): WhenEvalResult {
  const shape = checkSpecV2WhenShape(when);
  if (shape.length) {
    return { ok: false, detail: { error: "when_invalid", messages: shape } };
  }

  if (typeof when === "string") {
    const resolved = resolveRefs(when, scope);
    const ok = isTruthyWhen(resolved);
    return {
      ok,
      detail: { kind: "ref", ref: when, resolved, ok },
    };
  }

  if ("eq" in when) {
    const left = resolveRefs(when.eq, scope);
    const right = resolveRefs(when.value, scope);
    const ok = deepEqual(left, right);
    return { ok, detail: { kind: "eq", left, right, ok } };
  }
  if ("ne" in when) {
    const left = resolveRefs(when.ne, scope);
    const right = resolveRefs(when.value, scope);
    const ok = !deepEqual(left, right);
    return { ok, detail: { kind: "ne", left, right, ok } };
  }
  if ("in" in when) {
    const v = resolveRefs(when.in, scope);
    const list = resolveRefs(when.list, scope);
    const ok = Array.isArray(list) && list.some((item) => deepEqual(item, v));
    return {
      ok,
      detail: {
        kind: "in",
        value: v,
        listIsArray: Array.isArray(list),
        ok,
      },
    };
  }
  if ("exists" in when) {
    const v = resolveRefs(when.exists, scope);
    const ok = v !== null && v !== undefined;
    return { ok, detail: { kind: "exists", resolved: v, ok } };
  }

  return { ok: false, detail: { error: "when_empty" } };
}

function isTruthyWhen(v: unknown): boolean {
  if (v === false || v === null || v === undefined) return false;
  if (v === 0 || v === "") return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
