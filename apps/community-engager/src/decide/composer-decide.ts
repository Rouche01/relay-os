import type { Page } from "playwright";
import {
  observePage,
  resolveObserveLocator,
  type ObserveCandidate,
  type ObserveLocatorRef,
  type ObservePageResult,
} from "@relay/engines-browser";
import type { DecisionPort } from "@relay/engines-decide";
import {
  composerMinConfidence,
  createDecisionPort,
  routeDecision,
  withMinConfidence,
} from "@relay/engines-decide";
import type { DecisionAnswer, DecisionCandidate, DecisionRequest } from "@relay/protocol";

/** Composer flow steps DecisionPort may choose a control for. */
export type ComposerControlStep = "open_composer" | "editor" | "submit";

/** Sentinel — stuck / unclear → fall back to semantic locators (no auto-write). */
export const COMPOSER_ESCALATE_ID = "escalate";

export interface ComposerControlDecision {
  step: ComposerControlStep;
  selectedId: string | null;
  escalateHitl: boolean;
  confidence: number;
  backend: string;
  rationale?: string;
  locatorById: Record<string, ObserveLocatorRef>;
  observe: ObservePageResult;
}

const STEP_PROMPTS: Record<ComposerControlStep, string> = {
  open_composer:
    "Which control opens or focuses the Reddit post comment composer? " +
    "It may say “Add a comment”, “Join the conversation”, or similar — not Chat, Search, or Share.",
  editor:
    "Which control is the comment text editor (textbox / contenteditable) for writing a reply on this post?",
  submit:
    "Which control submits the comment (usually a Comment or Reply button — not “Add a comment” / “Join the conversation”)?",
};

/** Never offer these to decide (noise / dangerous mistaken clicks). */
const HARD_EXCLUDE_RE =
  /password|username|e-?mail|log\s*in|sign\s*up|upvote|downvote|award|give award|share|open.?chat|^chat$|search comments|search posts|notification|karma|profile menu/i;

const MAX_DECIDE_CANDIDATES = 16;

/**
 * Choose a composer control via DecisionPort Choice over observe candidates.
 * Locators stay in Relay. Submit *click* remains caller-gated (HITL Approve);
 * this only identifies the target — policy does not mark networkWrite so we
 * can resolve the button id after Approve has already been granted.
 */
export async function decideComposerControl(
  page: Page,
  step: ComposerControlStep,
  opts?: { decide?: DecisionPort; minConfidence?: number; maxCandidates?: number }
): Promise<ComposerControlDecision> {
  const decide = opts?.decide ?? createDecisionPort();
  const floor = opts?.minConfidence ?? composerMinConfidence();
  const observe = await observePage(page, {
    maxCandidates: opts?.maxCandidates ?? 24,
    maxTextChars: 2000,
  });
  const filtered = filterComposerCandidates(step, observe.candidates);
  const suggestedId = suggestComposerCandidateId(step, filtered);

  if (!filtered.length) {
    return {
      step,
      selectedId: null,
      escalateHitl: true,
      confidence: 0,
      backend: decide.backendName,
      rationale: "no-composer-candidates",
      locatorById: observe.locatorById,
      observe,
    };
  }

  let answer: DecisionAnswer;
  try {
    answer = await decide.decide(
      buildComposerControlRequest(step, filtered, suggestedId, observe, floor)
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[comment] decide failed — fallback (${message})`);
    return {
      step,
      selectedId: suggestedId ?? null,
      escalateHitl: !suggestedId,
      confidence: 0,
      backend: decide.backendName,
      rationale: `decide-error:${message}`,
      locatorById: observe.locatorById,
      observe,
    };
  }

  return interpretComposerControlAnswer(
    answer,
    step,
    filtered,
    suggestedId,
    observe,
    decide.backendName,
    floor
  );
}

export function buildComposerControlRequest(
  step: ComposerControlStep,
  candidates: ObserveCandidate[],
  suggestedId: string | undefined,
  observe: Pick<ObservePageResult, "url" | "title" | "text">,
  minConfidence: number
): DecisionRequest {
  const choiceCandidates: DecisionCandidate[] = [
    ...candidates.map((c) => ({
      id: c.id,
      label: c.label,
      hint: c.hint,
    })),
    {
      id: COMPOSER_ESCALATE_ID,
      label: "escalate",
      hint: "Unclear — use semantic fallback; never invent a submit",
    },
  ];

  return {
    state: {
      step,
      suggestedId: suggestedId ?? null,
      url: observe.url,
      title: observe.title,
      text: observe.text.slice(0, 1200),
      candidateLabels: candidates.map((c) => `${c.id}=${c.label}`),
      // Actuation of submit is only allowed after HITL Approve (caller).
      postApproveOnly: step === "submit",
    } as Record<string, unknown>,
    questions: [
      {
        id: "control",
        kind: "choice",
        prompt: STEP_PROMPTS[step],
        candidates: choiceCandidates,
      },
    ],
    policy: withMinConfidence(
      {
        // Identify controls only — do NOT set networkWrite here or every
        // submit-button Choice would escalate and never resolve an id.
        escalateFeedbackType: "confirmation",
      },
      minConfidence
    ),
    meta: { kind: "composer", step, postApproveOnly: step === "submit" },
  };
}

export function interpretComposerControlAnswer(
  answer: DecisionAnswer,
  step: ComposerControlStep,
  candidates: ObserveCandidate[],
  suggestedId: string | undefined,
  observe: ObservePageResult,
  backend: string,
  floor: number
): ComposerControlDecision {
  const route = routeDecision(answer, withMinConfidence({}, floor));
  const raw = answer.answers.control;
  const selectedRaw = raw?.kind === "choice" ? raw.selectedId : undefined;

  const knownIds = new Set(candidates.map((c) => c.id));
  const pickedEscalate = selectedRaw === COMPOSER_ESCALATE_ID;
  const validPick =
    selectedRaw && knownIds.has(selectedRaw) ? selectedRaw : null;

  let selectedId: string | null = validPick;
  // If decide picks a hard-noise control (e.g. chat), prefer heuristic suggest.
  if (selectedId) {
    const picked = candidates.find((c) => c.id === selectedId);
    if (picked && scoreCandidate(step, picked) < 0 && suggestedId) {
      console.warn(
        `[comment] decide pick id=${selectedId} scored low — using suggest=${suggestedId}`
      );
      selectedId = suggestedId;
    }
  }
  if (!pickedEscalate && !selectedId && suggestedId && knownIds.has(suggestedId)) {
    selectedId = suggestedId;
  }
  if (pickedEscalate) selectedId = null;

  return {
    step,
    selectedId,
    escalateHitl: pickedEscalate || route === "escalate" || !validPick,
    confidence: answer.confidence,
    backend,
    rationale: answer.rationale,
    locatorById: observe.locatorById,
    observe,
  };
}

/**
 * Broad pool for DecisionPort: every plausible textbox / composer control,
 * minus hard excludes. Phrase matching only ranks (suggest), it does not gate.
 */
export function filterComposerCandidates(
  step: ComposerControlStep,
  candidates: ObserveCandidate[]
): ObserveCandidate[] {
  const plausible = candidates.filter((c) => isPlausibleComposerCandidate(step, c));
  const pool = plausible.length ? plausible : candidates.slice(0, MAX_DECIDE_CANDIDATES);
  return [...pool]
    .sort((a, b) => scoreCandidate(step, b) - scoreCandidate(step, a))
    .slice(0, MAX_DECIDE_CANDIDATES);
}

export function suggestComposerCandidateId(
  step: ComposerControlStep,
  candidates: ObserveCandidate[]
): string | undefined {
  const scored = candidates
    .map((c) => ({ id: c.id, score: scoreCandidate(step, c) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.id;
}

export async function actComposerControl(
  page: Page,
  decision: ComposerControlDecision,
  action: "click" | "fill",
  value?: string
): Promise<boolean> {
  if (!decision.selectedId) return false;
  const ref = decision.locatorById[decision.selectedId];
  if (!ref) return false;
  const locator = resolveObserveLocator(page, ref).first();
  try {
    if (action === "fill") {
      if (value === undefined) return false;
      try {
        await locator.fill(value, { timeout: 8_000 });
      } catch {
        await locator.click({ timeout: 5_000 });
        await page.keyboard.type(value, { delay: 5 });
      }
    } else {
      await locator.click({ timeout: 8_000 });
    }
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[comment] act ${action} id=${decision.selectedId} failed: ${message}`
    );
    return false;
  }
}

/** Resolve decided editor to a Playwright locator (for fillComposer verify path). */
export function resolveComposerLocator(
  page: Page,
  decision: ComposerControlDecision
) {
  if (!decision.selectedId) return null;
  const ref = decision.locatorById[decision.selectedId];
  if (!ref) return null;
  return resolveObserveLocator(page, ref).first();
}

function candidateBlob(c: ObserveCandidate): string {
  return `${c.id} ${c.label} ${c.hint ?? ""} ${c.role ?? ""}`.toLowerCase();
}

/** Structural gate only — copy/phrases belong in {@link scoreCandidate}. */
export function isPlausibleComposerCandidate(
  step: ComposerControlStep,
  c: ObserveCandidate
): boolean {
  const blob = candidateBlob(c);
  if (HARD_EXCLUDE_RE.test(blob)) return false;

  const isTextish =
    c.role === "textbox" ||
    blob.includes("textbox") ||
    blob.includes("contenteditable") ||
    blob.includes("textarea") ||
    /join the conversation|add a comment|leave a comment|write a comment/i.test(
      blob
    );
  const isButton = c.role === "button" || blob.includes("button");

  switch (step) {
    case "open_composer":
      // Any text entry or button that might expand the composer — decide ranks.
      return isTextish || isButton;
    case "editor":
      return isTextish;
    case "submit":
      // Submit is a button; exclude the collapsed composer prompt itself.
      if (!isButton) return false;
      if (
        /add a comment|leave a comment|join the conversation|write a comment/i.test(
          blob
        )
      ) {
        return false;
      }
      return true;
  }
}

/**
 * Heuristic ranking for suggestedId. Positive = good hint for decide;
 * zero/negative = still may be in the pool but never auto-suggested.
 */
export function scoreCandidate(
  step: ComposerControlStep,
  c: ObserveCandidate
): number {
  if (!isPlausibleComposerCandidate(step, c)) return 0;
  const label = `${c.label} ${c.hint ?? ""}`.toLowerCase();
  const id = c.id.toLowerCase();
  let score = 1;

  if (step === "open_composer") {
    if (/join the conversation|add a comment|leave a comment/i.test(label))
      score += 5;
    if (/write a comment|comment here/i.test(label)) score += 3;
    if (c.role === "textbox" || /textbox|contenteditable/i.test(label))
      score += 2;
    if (/open.?chat|\bchat\b|share|award/i.test(`${label} ${id}`)) score -= 8;
    if (/^comment$/i.test(c.label.trim()) || /^reply$/i.test(c.label.trim()))
      score -= 3;
  }

  if (step === "editor") {
    if (/join the conversation|add a comment|leave a comment/i.test(label))
      score += 5;
    if (/contenteditable/i.test(c.hint ?? "")) score += 3;
    if (c.role === "textbox") score += 2;
    if (/search/i.test(label)) score -= 8;
  }

  if (step === "submit") {
    if (/^comment$/i.test(c.label.trim())) score += 6;
    if (/^reply$/i.test(c.label.trim())) score += 5;
    if (/\b(comment|reply)\b/i.test(label)) score += 2;
    if (/cancel|discard|delete|save draft/i.test(label)) score -= 6;
  }

  return score;
}
