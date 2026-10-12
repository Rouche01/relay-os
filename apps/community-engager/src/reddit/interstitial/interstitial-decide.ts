import type { Page } from "playwright";
import type { DecisionPort } from "@relay/engines-decide";
import {
  createDecisionPort,
  interstitialMinConfidence,
  routeDecision,
  withMinConfidence,
} from "@relay/engines-decide";
import type { DecisionAnswer, DecisionRequest } from "@relay/protocol";
import {
  detectInterstitial,
  type InterstitialDetection,
  type InterstitialReason,
} from "./reddit/interstitial.js";

/** Page classes for DecisionPort Choice (Phase B). */
export type PageClass =
  | "feed"
  | "login"
  | "interstitial"
  | "rate_limit"
  | "unknown";

export const PAGE_CLASS_CANDIDATES: Array<{
  id: PageClass;
  label: string;
  hint: string;
}> = [
  {
    id: "feed",
    label: "feed",
    hint: "Normal listing or post page with content",
  },
  {
    id: "login",
    label: "login",
    hint: "Login / signup wall or auth modal",
  },
  {
    id: "interstitial",
    label: "interstitial",
    hint: "Prove-humanity / CAPTCHA / network security wall",
  },
  {
    id: "rate_limit",
    label: "rate_limit",
    hint: "Too many requests / cool-down wall",
  },
  {
    id: "unknown",
    label: "unknown",
    hint: "Cannot tell — escalate to human",
  },
];

export interface PageClassDecision {
  pageClass: PageClass;
  detection: InterstitialDetection;
  confidence: number;
  /** True when scout/discover should pause for confirmation HITL. */
  escalateHitl: boolean;
  backend: string;
  rationale?: string;
}

/**
 * Classify a live page via DecisionPort (Choice).
 * Deterministic detectInterstitial seeds state; low confidence escalates to HITL.
 * Never auto-solves CAPTCHAs.
 */
export async function detectInterstitialDecided(
  page: Page,
  opts?: { decide?: DecisionPort; minConfidence?: number }
): Promise<PageClassDecision> {
  const heuristic = await detectInterstitial(page);
  const snap = await snapshotPageClassState(page, heuristic);
  const decide = opts?.decide ?? createDecisionPort();
  const floor = opts?.minConfidence ?? interstitialMinConfidence();

  let answer: DecisionAnswer;
  try {
    answer = await decide.decide(buildPageClassRequest(snap, floor));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[interstitial] decide failed — using heuristic (${message})`);
    return fromHeuristicOnly(heuristic, decide.backendName, floor);
  }

  return interpretPageClassAnswer(answer, heuristic, decide.backendName, floor);
}

export function buildPageClassRequest(
  snap: PageClassState,
  minConfidence: number
): DecisionRequest {
  return {
    state: { ...snap } as Record<string, unknown>,
    questions: [
      {
        id: "page",
        kind: "choice",
        prompt: "What kind of Reddit page is this?",
        candidates: PAGE_CLASS_CANDIDATES.map((c) => ({
          id: c.id,
          label: c.label,
          hint: c.hint,
        })),
      },
    ],
    policy: withMinConfidence(
      {
        // CAPTCHA / humanity — never auto-act past a wall on confidence alone
        // when the model picks interstitial; escalate path still HITL.
        captchaOrHumanity: false,
        escalateFeedbackType: "confirmation",
      },
      minConfidence
    ),
    meta: { kind: "interstitial" },
  };
}

export function interpretPageClassAnswer(
  answer: DecisionAnswer,
  heuristic: InterstitialDetection,
  backend: string,
  floor: number
): PageClassDecision {
  const route = routeDecision(answer, withMinConfidence({}, floor));
  const raw = answer.answers.page;
  let pageClass: PageClass =
    raw?.kind === "choice" && isPageClass(raw.selectedId)
      ? raw.selectedId
      : "unknown";

  // Low confidence / escalate → unknown + HITL (reuse scout confirmation).
  const escalateHitl = route === "escalate" || pageClass === "unknown";
  if (route === "escalate") pageClass = "unknown";

  const detection = pageClassToDetection(pageClass, heuristic);

  // If we escalated but heuristic already saw a clear wall, keep that reason
  // for logging / credential vs confirmation routing.
  if (escalateHitl && heuristic.challenged && heuristic.reason) {
    detection.challenged = true;
    detection.reason = heuristic.reason;
  } else if (escalateHitl) {
    detection.challenged = true;
    detection.reason = detection.reason ?? "unknown";
  }

  return {
    pageClass,
    detection,
    confidence: answer.confidence,
    escalateHitl,
    backend,
    rationale: answer.rationale,
  };
}

export function pageClassToDetection(
  pageClass: PageClass,
  heuristic: InterstitialDetection
): InterstitialDetection {
  const title = heuristic.title;
  switch (pageClass) {
    case "feed":
      return { challenged: false, title };
    case "login":
      return { challenged: true, reason: "login_wall", title };
    case "interstitial":
      return {
        challenged: true,
        // Preserve captcha_widget so scout soft-confirm (listing ready) still works.
        reason:
          heuristic.reason === "captcha_widget"
            ? "captcha_widget"
            : "humanity_wall",
        title,
      };
    case "rate_limit":
      return { challenged: true, reason: "rate_limit", title };
    case "unknown":
      return {
        challenged: true,
        reason: "unknown",
        title,
      };
  }
}

export function heuristicToPageClass(
  detection: InterstitialDetection
): PageClass {
  if (!detection.challenged) return "feed";
  switch (detection.reason as InterstitialReason | undefined) {
    case "rate_limit":
      return "rate_limit";
    case "login_wall":
      return "login";
    case "humanity_wall":
    case "captcha_widget":
      return "interstitial";
    default:
      return "unknown";
  }
}

interface PageClassState {
  suggestedClass: PageClass;
  title: string;
  bodyText: string;
  hasFeedContent: boolean;
  hasAuthModal: boolean;
  onAuthPath: boolean;
  heuristicChallenged: boolean;
  heuristicReason?: string;
}

async function snapshotPageClassState(
  page: Page,
  heuristic: InterstitialDetection
): Promise<PageClassState> {
  const flags = await page
    .evaluate(() => {
      const title = document.title ?? "";
      const bodyText = (document.body?.innerText ?? "").slice(0, 2500);
      const hasAuthModal = Boolean(
        document.querySelector('[data-testid="login-username"]') ||
          document.querySelector('input[name="username"]') ||
          document.querySelector('faceplate-text-input[name="username"]') ||
          document.querySelector("#login-username")
      );
      const hasFeedContent = Boolean(
        document.querySelector("shreddit-post") ||
          document.querySelector('[data-testid="post-container"]') ||
          document.querySelector("article[id^='t3_']") ||
          document.querySelector("shreddit-feed")
      );
      const path = (location.pathname || "").toLowerCase();
      const onAuthPath =
        path.includes("/login") ||
        path.includes("/register") ||
        path.includes("/account");
      return { title, bodyText, hasAuthModal, hasFeedContent, onAuthPath };
    })
    .catch(() => ({
      title: heuristic.title ?? "",
      bodyText: "",
      hasAuthModal: false,
      hasFeedContent: false,
      onAuthPath: false,
    }));

  return {
    suggestedClass: heuristicToPageClass(heuristic),
    title: flags.title,
    bodyText: flags.bodyText,
    hasFeedContent: flags.hasFeedContent,
    hasAuthModal: flags.hasAuthModal,
    onAuthPath: flags.onAuthPath,
    heuristicChallenged: heuristic.challenged,
    heuristicReason: heuristic.reason,
  };
}

function fromHeuristicOnly(
  heuristic: InterstitialDetection,
  backend: string,
  floor: number
): PageClassDecision {
  const pageClass = heuristicToPageClass(heuristic);
  const confidence = pageClass === "unknown" ? 0 : Math.max(floor, 0.85);
  return {
    pageClass,
    detection: heuristic,
    confidence,
    escalateHitl: pageClass === "unknown",
    backend,
    rationale: "heuristic-fallback",
  };
}

function isPageClass(id: string): id is PageClass {
  return PAGE_CLASS_CANDIDATES.some((c) => c.id === id);
}
