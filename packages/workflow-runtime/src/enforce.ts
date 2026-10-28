import type {
  ExecutionEngine,
  SpecV2HardCheck,
  SpecV2HardRule,
  SpecV2Rule,
  SpecV2SoftRule,
} from "@relay/protocol";
import { resolveRefs, type RefScope } from "./refs.js";

export type EnforceResult = {
  ruleId: string;
  kind: SpecV2Rule["kind"];
  passed: boolean;
  detail?: Record<string, unknown>;
};

export class EnforceError extends Error {
  readonly results: EnforceResult[];

  constructor(message: string, results: EnforceResult[]) {
    super(message);
    this.name = "EnforceError";
    this.results = results;
  }
}

/**
 * Evaluate rule ids listed on a step against the step output (fail closed).
 * Soft rules require an llm engine; outcome rules are recorded only (not blocking).
 */
export async function enforceRules(options: {
  ruleIds: string[];
  rules: SpecV2Rule[];
  /** Output of the step under enforcement. */
  output: unknown;
  scope: RefScope;
  llmEngine?: ExecutionEngine;
  softFailClosed?: boolean;
}): Promise<EnforceResult[]> {
  const {
    ruleIds,
    rules,
    output,
    scope,
    llmEngine,
    softFailClosed = true,
  } = options;

  const byId = new Map(rules.map((r) => [r.id, r]));
  const results: EnforceResult[] = [];

  // Scope includes the raw output under `output` for checks that need it.
  const checkScope: RefScope = { ...scope, output };

  for (const id of ruleIds) {
    const rule = byId.get(id);
    if (!rule) {
      throw new EnforceError(`Unknown rule id in enforce: ${JSON.stringify(id)}`, [
        { ruleId: id, kind: "hard", passed: false, detail: { error: "unknown_rule" } },
      ]);
    }

    if (rule.kind === "hard") {
      const passed = evaluateHard(rule.check, checkScope);
      results.push({
        ruleId: id,
        kind: "hard",
        passed,
        detail: { check: rule.check },
      });
      if (!passed) {
        throw new EnforceError(
          `Hard rule ${JSON.stringify(id)} failed on step output`,
          results
        );
      }
      continue;
    }

    if (rule.kind === "soft") {
      const soft = await evaluateSoft(rule, output, llmEngine, softFailClosed);
      results.push(soft);
      if (!soft.passed) {
        throw new EnforceError(
          `Soft rule ${JSON.stringify(id)} failed`,
          results
        );
      }
      continue;
    }

    // Outcome rules are measured after the run — record only.
    results.push({
      ruleId: id,
      kind: "outcome",
      passed: true,
      detail: { deferred: true, metric: rule.metric },
    });
  }

  return results;
}

export function evaluateHard(
  check: SpecV2HardCheck,
  scope: RefScope
): boolean {
  if ("in" in check) {
    const v = resolveRefs(check.in, scope);
    const list = resolveRefs(check.list, scope);
    if (!Array.isArray(list)) return false;
    return list.some((item) => deepEqual(item, v));
  }
  if ("notIn" in check) {
    const v = resolveRefs(check.notIn, scope);
    const list = resolveRefs(check.list, scope);
    if (!Array.isArray(list)) return true;
    return !list.some((item) => deepEqual(item, v));
  }
  if ("matches" in check) {
    const v = resolveRefs(check.matches, scope);
    const pattern = String(resolveRefs(check.pattern, scope) ?? "");
    return new RegExp(pattern).test(stringifyForMatch(v));
  }
  if ("notMatches" in check) {
    const v = resolveRefs(check.notMatches, scope);
    const pattern = String(resolveRefs(check.pattern, scope) ?? "");
    return !new RegExp(pattern).test(stringifyForMatch(v));
  }
  if ("eq" in check) {
    return deepEqual(
      resolveRefs(check.eq, scope),
      resolveRefs(check.value, scope)
    );
  }
  if ("neq" in check) {
    return !deepEqual(
      resolveRefs(check.neq, scope),
      resolveRefs(check.value, scope)
    );
  }
  if ("gt" in check) {
    const a = asNumber(resolveRefs(check.gt, scope));
    const b = asNumber(resolveRefs(check.value, scope));
    return a !== null && b !== null && a > b;
  }
  if ("gte" in check) {
    const a = asNumber(resolveRefs(check.gte, scope));
    const b = asNumber(resolveRefs(check.value, scope));
    return a !== null && b !== null && a >= b;
  }
  if ("lt" in check) {
    const a = asNumber(resolveRefs(check.lt, scope));
    const b = asNumber(resolveRefs(check.value, scope));
    return a !== null && b !== null && a < b;
  }
  if ("lte" in check) {
    const a = asNumber(resolveRefs(check.lte, scope));
    const b = asNumber(resolveRefs(check.value, scope));
    return a !== null && b !== null && a <= b;
  }
  return false;
}

async function evaluateSoft(
  rule: SpecV2SoftRule,
  output: unknown,
  llmEngine: ExecutionEngine | undefined,
  softFailClosed: boolean
): Promise<EnforceResult> {
  if (!llmEngine || llmEngine.type !== "llm") {
    if (softFailClosed) {
      return {
        ruleId: rule.id,
        kind: "soft",
        passed: false,
        detail: { error: "llm_required" },
      };
    }
    return {
      ruleId: rule.id,
      kind: "soft",
      passed: true,
      detail: { skipped: "soft_unevaluated" },
    };
  }

  const result = await llmEngine.execute({
    type: "judge",
    params: {
      input: output,
      rubric: rule.judge.rubric,
      minMean: rule.judge.minMean,
    },
  });

  if (!result.success) {
    return {
      ruleId: rule.id,
      kind: "soft",
      passed: false,
      detail: { error: result.error ?? "judge_failed" },
    };
  }

  const data = result.data as {
    mean?: number;
    passed?: boolean;
    scores?: Record<string, number>;
  };
  const minMean = rule.judge.minMean;
  const passed =
    typeof data.passed === "boolean"
      ? data.passed
      : minMean === undefined
        ? true
        : typeof data.mean === "number" && data.mean >= minMean;

  return {
    ruleId: rule.id,
    kind: "soft",
    passed,
    detail: {
      mean: data.mean,
      scores: data.scores,
      minMean,
    },
  };
}

/** Exported for hard-rule unit tests. */
export function evaluateHardRule(
  rule: SpecV2HardRule,
  scope: RefScope
): boolean {
  return evaluateHard(rule.check, scope);
}

function stringifyForMatch(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  if (typeof v === "object" && v !== null && "text" in v) {
    return String((v as { text: unknown }).text ?? "");
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
