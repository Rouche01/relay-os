import {
  isSpecV2Ref,
  type SpecV2Body,
  type SpecV2HardCheck,
  type SpecV2HardRule,
  type SpecV2Rule,
} from "@relay/protocol";

/** Default subject when the LLM collapses the regex into `notMatches`/`matches`. */
export const DEFAULT_HARD_MATCH_SUBJECT = "${draft.text}";

/**
 * True when a string looks like a regex pattern rather than a Spec ref / prose.
 * Used to detect LLM collapse: `notMatches: "https?://"` with no `pattern`.
 */
export function looksLikeCollapsedRegexPattern(value: string): boolean {
  const s = value.trim();
  if (!s || isSpecV2Ref(s)) return false;
  return (
    /https?\??:/i.test(s) ||
    /www\\?\./i.test(s) ||
    /[\\^$*+?()[\]{|]/.test(s)
  );
}

function normalizeHardCheck(
  check: SpecV2HardCheck
): SpecV2HardCheck {
  const raw = check as Record<string, unknown>;

  for (const key of ["notMatches", "matches"] as const) {
    if (!(key in raw)) continue;
    if (typeof raw.pattern === "string" && raw.pattern.length > 0) {
      continue;
    }
    const subject = raw[key];
    if (typeof subject !== "string") continue;
    if (!looksLikeCollapsedRegexPattern(subject)) continue;

    return {
      ...raw,
      [key]: DEFAULT_HARD_MATCH_SUBJECT,
      pattern: subject,
    } as SpecV2HardCheck;
  }

  return check;
}

function normalizeRule(rule: SpecV2Rule): SpecV2Rule {
  if (rule.kind !== "hard") return rule;
  const hard = rule as SpecV2HardRule;
  const check = normalizeHardCheck(hard.check);
  if (check === hard.check) return rule;
  return { ...hard, check };
}

/**
 * Repair common LLM hard-check collapse:
 * `{ notMatches: "https?://|www\\." }` →
 * `{ notMatches: "${draft.text}", pattern: "https?://|www\\." }`.
 *
 * Idempotent. Does not invent patterns when the subject is already a ref.
 */
export function normalizeSpecV2HardChecks(body: SpecV2Body): SpecV2Body {
  const rules = body.rules;
  if (!rules?.length) return body;

  let changed = false;
  const next = rules.map((rule) => {
    const fixed = normalizeRule(rule);
    if (fixed !== rule) changed = true;
    return fixed;
  });

  return changed ? { ...body, rules: next } : body;
}
