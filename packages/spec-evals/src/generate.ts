/**
 * Derive offline eval fixtures + acceptance cases from a Spec body.
 *
 * Replaces Desk-local `deskEvalFixtures` heuristics — scaffolder and hosts
 * share one generator so pre-freeze gates use the same cases.
 */

import {
  isSpecV2Ref,
  parseSpecV2Ref,
  type SpecV2Body,
  type SpecV2HardCheck,
  type SpecV2HardRule,
} from "@relay/protocol";
import type { EvalCase, EvalFixturePack } from "./types.js";

export type GenerateEvalFixturesOptions = {
  /**
   * When true (default), emit at least one positive acceptance case when any
   * hard rule is evaluable offline.
   */
  includeAcceptance?: boolean;
  /** Emit counterexamples that must fail (default true). */
  includeCounterexamples?: boolean;
};

/**
 * Build an {@link EvalFixturePack} from Spec hard rules (in/list, notMatches,
 * matches, eq/neq). Soft/outcome rules are not fixture-evaluated here.
 */
export function generateEvalFixtures(
  body: SpecV2Body,
  options: GenerateEvalFixturesOptions = {}
): EvalFixturePack {
  const includeAcceptance = options.includeAcceptance !== false;
  const includeCounterexamples = options.includeCounterexamples !== false;

  const hard = (body.rules ?? []).filter(
    (r): r is SpecV2HardRule => r.kind === "hard"
  );
  const draftStep =
    body.steps.find((s) => s.use === "llm.generate")?.id ??
    body.steps.find((s) => /draft|reply|generate|compose/i.test(s.id))?.id ??
    body.steps.find((s) => (s.enforce?.length ?? 0) > 0)?.id ??
    "draft";

  const promo = hard.find(
    (r) => "notMatches" in r.check || /promo|link|url|http/i.test(r.id)
  );
  const allow = hard.find(
    (r) => "in" in r.check || /allow|subreddit|allowlist|label/i.test(r.id)
  );
  const eqRules = hard.filter((r) => "eq" in r.check || "neq" in r.check);

  const goodText = "Pick one versatile base layer.";
  const badText = "see https://spam.example/fit";
  const goodListValue = pickAllowlistValue(allow?.check) ?? "allowed";
  const badListValue = "OUT_OF_ALLOWLIST";

  const cases: EvalCase[] = [];

  function scopeFor(opts: {
    text: string;
    listValue: string;
    extra?: Record<string, unknown>;
  }): Record<string, unknown> {
    const draft = { text: opts.text };
    const scope: Record<string, unknown> = {
      draft,
      output: draft,
      item: { subreddit: opts.listValue, label: opts.listValue, id: opts.listValue },
      steps: { [draftStep]: { output: draft } },
      [draftStep]: draft,
      ...opts.extra,
    };

    for (const rule of hard) {
      bindHardCheckPaths(scope, rule.check, {
        text: opts.text,
        listValue: opts.listValue,
        draft,
      });
    }
    return scope;
  }

  const acceptanceRuleIds = [
    ...new Set(
      [promo?.id, allow?.id, ...eqRules.map((r) => r.id)].filter(
        (id): id is string => typeof id === "string"
      )
    ),
  ];

  if (includeAcceptance && acceptanceRuleIds.length) {
    cases.push({
      id: "acceptance_good",
      description: "Acceptance — hard rules pass on a clean fixture",
      stepId: draftStep,
      rules: acceptanceRuleIds,
      output: { text: goodText },
      scope: scopeFor({ text: goodText, listValue: goodListValue }),
      expect: { pass: true },
    });
  }

  if (includeCounterexamples && promo && "notMatches" in promo.check) {
    cases.push({
      id: "counter_promo",
      description: "Counterexample — promo/link must fail notMatches",
      stepId: draftStep,
      rules: [promo.id],
      output: { text: badText },
      scope: scopeFor({ text: badText, listValue: goodListValue }),
      expect: { rules: { [promo.id]: false } },
    });
  }

  if (includeCounterexamples && allow && "in" in allow.check) {
    cases.push({
      id: "counter_allowlist",
      description: "Counterexample — off-allowlist value must fail in/list",
      stepId: draftStep,
      rules: [allow.id],
      output: { text: goodText },
      scope: scopeFor({ text: goodText, listValue: badListValue }),
      expect: { rules: { [allow.id]: false } },
    });
  }

  if (includeCounterexamples) {
    for (const rule of eqRules) {
      const check = rule.check;
      if ("eq" in check) {
        const bad = inventNeq(check.value);
        cases.push({
          id: `counter_eq_${rule.id}`,
          description: `Counterexample — ${rule.id} eq must fail`,
          stepId: draftStep,
          rules: [rule.id],
          output: { text: goodText, value: bad },
          scope: scopeFor({
            text: goodText,
            listValue: goodListValue,
            extra: bindEqSubject(check.eq, bad),
          }),
          expect: { rules: { [rule.id]: false } },
        });
      }
      if ("neq" in check) {
        const same = check.value;
        cases.push({
          id: `counter_neq_${rule.id}`,
          description: `Counterexample — ${rule.id} neq must fail when equal`,
          stepId: draftStep,
          rules: [rule.id],
          output: { text: goodText, value: same },
          scope: scopeFor({
            text: goodText,
            listValue: goodListValue,
            extra: bindEqSubject(check.neq, same),
          }),
          expect: { rules: { [rule.id]: false } },
        });
      }
    }
  }

  return { cases };
}

/** True when the pack has at least one case (usable as a pre-freeze gate). */
export function hasEvaluableFixtures(pack: EvalFixturePack): boolean {
  return pack.cases.length > 0;
}

function pickAllowlistValue(check: SpecV2HardCheck | undefined): string | undefined {
  if (!check || !("in" in check)) return undefined;
  const list = check.list;
  if (Array.isArray(list) && list.length) {
    const first = list[0];
    if (typeof first === "string" || typeof first === "number") {
      return String(first);
    }
  }
  return undefined;
}

function inventNeq(value: unknown): unknown {
  if (typeof value === "number") return value + 1;
  if (typeof value === "boolean") return !value;
  if (typeof value === "string") return `${value}__bad`;
  return "__bad__";
}

function bindEqSubject(
  subject: unknown,
  value: unknown
): Record<string, unknown> {
  if (typeof subject === "string" && isSpecV2Ref(subject)) {
    const path = parseSpecV2Ref(subject);
    if (path) {
      const scope: Record<string, unknown> = {};
      assignPath(scope, path, value);
      return scope;
    }
  }
  return { output: value };
}

function bindHardCheckPaths(
  scope: Record<string, unknown>,
  check: SpecV2HardCheck,
  vals: { text: string; listValue: string; draft: { text: string } }
): void {
  if ("notMatches" in check || "matches" in check) {
    const raw =
      "notMatches" in check
        ? String(check.notMatches ?? "")
        : String((check as { matches?: unknown }).matches ?? "");
    const path = parseSpecV2Ref(raw);
    if (path) {
      if (path.endsWith(".text") || path === "text") {
        assignPath(scope, path, vals.text);
      } else {
        // Never assign the shared `draft` object — e.g. ${draft.channel_name}
        // would set draft.channel_name = draft and break JSON.stringify.
        assignPath(scope, path, { text: vals.text });
      }
    }
  }
  if ("in" in check || "notIn" in check) {
    const raw =
      "in" in check
        ? String(check.in ?? "")
        : String((check as { notIn?: unknown }).notIn ?? "");
    const path = parseSpecV2Ref(raw);
    if (path) assignPath(scope, path, vals.listValue);
  }
  if ("eq" in check) {
    const path =
      typeof check.eq === "string" ? parseSpecV2Ref(check.eq) : undefined;
    if (path) assignPath(scope, path, check.value);
  }
  if ("neq" in check) {
    const path =
      typeof check.neq === "string" ? parseSpecV2Ref(check.neq) : undefined;
    // For acceptance scope, set subject ≠ value when possible
    if (path) assignPath(scope, path, inventNeq(check.value));
  }
}

function assignPath(
  root: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const parts = path.split(".").filter(Boolean);
  if (!parts.length) return;
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    const next = cur[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cur[key] = {};
    }
    cur = cur[key] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}
