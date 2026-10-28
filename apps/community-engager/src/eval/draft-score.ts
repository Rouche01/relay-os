import { PRODUCT_RE } from "../stages/draft/soft-cta.js";
import type { CommunityDraft } from "../types.js";
import type { DraftEvalCase } from "./draft-cases.js";

export const SHARED_AI_TELL_PHRASES = [
  "from the pic, yeah",
  "from the pics, yeah",
  "you'd want",
  "check out",
  "happy to help",
  "feel free to",
  "great question",
  "as an ai",
  "game changer",
  "i'd love to",
  "hey -",
  "hey —",
  "simple approach",
] as const;

export type DraftScoreSeverity = "fail" | "warn";

export interface DraftScoreFinding {
  id: string;
  severity: DraftScoreSeverity;
  message: string;
}

export interface DraftScoreResult {
  ok: boolean;
  findings: DraftScoreFinding[];
}

function hasEmOrEnDash(text: string): boolean {
  return /[—–]/.test(text);
}

function phraseHits(text: string, phrases: readonly string[]): string[] {
  const lower = text.toLowerCase();
  return phrases.filter((p) => lower.includes(p.toLowerCase()));
}

function groundingHits(text: string, tokens: readonly string[]): string[] {
  const lower = text.toLowerCase();
  return tokens.filter((t) => lower.includes(t.toLowerCase()));
}

function approxSentenceCount(text: string): number {
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean).length;
}

/**
 * Deterministic humanity / thread-fit checks (no API).
 * Fails on em dashes, banned tells, missing grounding, product when help-only.
 * Soft sentence-count band is a warn only.
 */
export function scoreDraft(
  draft: CommunityDraft,
  evalCase: DraftEvalCase
): DraftScoreResult {
  const findings: DraftScoreFinding[] = [];
  const text = draft.draftText ?? "";

  if (hasEmOrEnDash(text)) {
    findings.push({
      id: "em_dash",
      severity: "fail",
      message: "draft contains em/en dashes",
    });
  }

  const banned = [
    ...SHARED_AI_TELL_PHRASES,
    ...(evalCase.bannedPhrases ?? []),
  ];
  const hitPhrases = phraseHits(text, banned);
  if (hitPhrases.length) {
    findings.push({
      id: "banned_phrase",
      severity: "fail",
      message: `banned phrase(s): ${hitPhrases.join(", ")}`,
    });
  }

  const grounded = groundingHits(text, evalCase.mustGroundIn);
  if (evalCase.mustGroundIn.length > 0 && grounded.length === 0) {
    findings.push({
      id: "grounding",
      severity: "fail",
      message: `missing grounding tokens: ${evalCase.mustGroundIn.join(", ")}`,
    });
  }

  const sentences = approxSentenceCount(text);
  if (sentences < 2 || sentences > 5) {
    findings.push({
      id: "length",
      severity: "warn",
      message: `sentence count ${sentences} outside soft 2–5 band`,
    });
  }

  const maxIntensity = evalCase.maxIntensity;
  if (maxIntensity !== undefined && draft.intensity > maxIntensity) {
    findings.push({
      id: "intensity",
      severity: "fail",
      message: `intensity ${draft.intensity} > max ${maxIntensity}`,
    });
  }

  if (
    (evalCase.forceIntensity0 || maxIntensity === 0) &&
    PRODUCT_RE.test(text)
  ) {
    findings.push({
      id: "product_help_only",
      severity: "fail",
      message: "GoStylens mention while help-only / intensity 0 expected",
    });
  }

  const ok = !findings.some((f) => f.severity === "fail");
  return { ok, findings };
}
