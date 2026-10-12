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
  createDecisionPort,
  loginMinConfidence,
  routeDecision,
  withMinConfidence,
} from "@relay/engines-decide";
import type { DecisionAnswer, DecisionCandidate, DecisionRequest } from "@relay/protocol";

/** Login flow steps that DecisionPort may choose a control for. */
export type LoginControlStep =
  | "open_login"
  | "username"
  | "password"
  | "submit";

/** Sentinel Choice id — OTP / CAPTCHA / stuck → onChallenge HITL. */
export const LOGIN_ESCALATE_ID = "escalate";

export interface LoginControlDecision {
  step: LoginControlStep;
  /** Observe candidate id, or null when escalate / fallback. */
  selectedId: string | null;
  escalateHitl: boolean;
  confidence: number;
  backend: string;
  rationale?: string;
  /** Actuation map from the observe pass (never sent to Jev). */
  locatorById: Record<string, ObserveLocatorRef>;
  observe: ObservePageResult;
}

const STEP_PROMPTS: Record<LoginControlStep, string> = {
  open_login: "Which control opens the Reddit login form?",
  username: "Which control is the username / email field?",
  password: "Which control is the password field?",
  submit: "Which control submits the login form?",
};

/**
 * Choose a login control via DecisionPort Choice over observe candidates.
 * OTP / CAPTCHA / low confidence → escalateHitl (caller uses onChallenge).
 * Locators stay in Relay via locatorById.
 */
export async function decideLoginControl(
  page: Page,
  step: LoginControlStep,
  opts?: { decide?: DecisionPort; minConfidence?: number; maxCandidates?: number }
): Promise<LoginControlDecision> {
  const decide = opts?.decide ?? createDecisionPort();
  const floor = opts?.minConfidence ?? loginMinConfidence();
  const observe = await observePage(page, {
    maxCandidates: opts?.maxCandidates ?? 24,
    maxTextChars: 2000,
  });
  const filtered = filterLoginCandidates(step, observe.candidates);
  const suggestedId = suggestLoginCandidateId(step, filtered);

  if (!filtered.length) {
    return {
      step,
      selectedId: null,
      escalateHitl: true,
      confidence: 0,
      backend: decide.backendName,
      rationale: "no-login-candidates",
      locatorById: observe.locatorById,
      observe,
    };
  }

  let answer: DecisionAnswer;
  try {
    answer = await decide.decide(
      buildLoginControlRequest(step, filtered, suggestedId, observe, floor)
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[login] decide failed — escalate (${message})`);
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

  return interpretLoginControlAnswer(
    answer,
    step,
    filtered,
    suggestedId,
    observe,
    decide.backendName,
    floor
  );
}

export function buildLoginControlRequest(
  step: LoginControlStep,
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
      id: LOGIN_ESCALATE_ID,
      label: "escalate",
      hint: "OTP, CAPTCHA, or unclear — human should finish in the browser",
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
        // Never auto-act past OTP/CAPTCHA; escalate Choice id handles that.
        captchaOrHumanity: false,
        escalateFeedbackType: "confirmation",
      },
      minConfidence
    ),
    meta: { kind: "login", step },
  };
}

export function interpretLoginControlAnswer(
  answer: DecisionAnswer,
  step: LoginControlStep,
  candidates: ObserveCandidate[],
  suggestedId: string | undefined,
  observe: ObservePageResult,
  backend: string,
  floor: number
): LoginControlDecision {
  const route = routeDecision(answer, withMinConfidence({}, floor));
  const raw = answer.answers.control;
  const selectedRaw =
    raw?.kind === "choice" ? raw.selectedId : undefined;

  const knownIds = new Set(candidates.map((c) => c.id));
  const pickedEscalate = selectedRaw === LOGIN_ESCALATE_ID;
  const validPick =
    selectedRaw && knownIds.has(selectedRaw) ? selectedRaw : null;

  const escalateHitl =
    route === "escalate" || pickedEscalate || !validPick;

  // Low confidence with a clear suggest → keep suggest for semantic fallback
  // (caller may still act without HITL when escalateHitl && selectedId set).
  let selectedId: string | null = validPick;
  if (escalateHitl && !selectedId && suggestedId && knownIds.has(suggestedId)) {
    selectedId = suggestedId;
  }
  if (pickedEscalate) {
    selectedId = null;
  }

  return {
    step,
    selectedId: pickedEscalate ? null : selectedId,
    escalateHitl: pickedEscalate || route === "escalate" || !validPick,
    confidence: answer.confidence,
    backend,
    rationale: answer.rationale,
    locatorById: observe.locatorById,
    observe,
  };
}

/** Narrow observe candidates to ones plausible for this login step. */
export function filterLoginCandidates(
  step: LoginControlStep,
  candidates: ObserveCandidate[]
): ObserveCandidate[] {
  const matched = candidates.filter((c) => matchesStep(step, c));
  return matched.length ? matched : candidates.slice(0, 12);
}

/** Deterministic hint id for heuristic backend / fallback. */
export function suggestLoginCandidateId(
  step: LoginControlStep,
  candidates: ObserveCandidate[]
): string | undefined {
  const scored = candidates
    .map((c) => ({ id: c.id, score: scoreCandidate(step, c) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.id;
}

/** Actuate a decided observe id on the page. */
export async function actLoginControl(
  page: Page,
  decision: LoginControlDecision,
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
      await locator.fill(value, { timeout: 8_000 });
    } else {
      await locator.click({ timeout: 8_000 });
    }
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[login] act ${action} id=${decision.selectedId} failed: ${message}`
    );
    return false;
  }
}

function matchesStep(step: LoginControlStep, c: ObserveCandidate): boolean {
  const label = `${c.label} ${c.hint ?? ""} ${c.role ?? ""}`.toLowerCase();
  switch (step) {
    case "open_login":
      return (
        (c.role === "link" || c.role === "button" || label.includes("link")) &&
        /log\s*in|sign\s*in/i.test(label)
      );
    case "username":
      return (
        (c.role === "textbox" || label.includes("textbox") || label.includes("input")) &&
        !/password/i.test(label) &&
        /user|email|username|login/i.test(label)
      );
    case "password":
      return /password/i.test(label) || /type=password/i.test(c.hint ?? "");
    case "submit":
      return (
        (c.role === "button" || label.includes("button")) &&
        /log\s*in|sign\s*in|submit|continue/i.test(label)
      );
  }
}

function scoreCandidate(step: LoginControlStep, c: ObserveCandidate): number {
  if (!matchesStep(step, c)) return 0;
  const label = `${c.label} ${c.hint ?? ""}`.toLowerCase();
  let score = 1;
  if (step === "open_login" && /^log\s*in$/i.test(c.label.trim())) score += 3;
  if (step === "username" && /email or username/i.test(label)) score += 3;
  if (step === "password" && /type=password/i.test(c.hint ?? "")) score += 3;
  if (step === "submit" && /^log\s*in$/i.test(c.label.trim())) score += 3;
  if (c.id.startsWith("testid:")) score += 1;
  return score;
}
