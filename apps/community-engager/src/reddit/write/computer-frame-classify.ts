import type { DecisionPort } from "@relay/engines-decide";
import {
  createDecisionPort,
  interstitialMinConfidence,
} from "@relay/engines-decide";
import type { DecisionAnswer } from "@relay/protocol";
import {
  buildPageClassRequest,
  interpretPageClassAnswer,
  pageClassToDetection,
  type PageClass,
  type PageClassDecision,
} from "../../decide/interstitial-decide.js";
import type { InterstitialDetection } from "../interstitial/interstitial.js";

export type ComputerFrameClassifyPhase = "assume_wall" | "recheck";

export interface ClassifyComputerFrameOptions {
  /** Absolute path to the PNG just captured from the desktop. */
  evidencePath: string;
  vncUrl?: string;
  /**
   * Hint from the caller (login URL vs CAPTCHA escalation).
   * Used for assume_wall; ignored as a hard force on recheck.
   */
  reason?: "login" | "interstitial";
  /**
   * assume_wall — seed heuristic toward login/interstitial (first look).
   * recheck — after human may have cleared; do not force a wall class.
   */
  phase?: ComputerFrameClassifyPhase;
  decide?: DecisionPort;
  minConfidence?: number;
  /** Test / dogfood override — skip decide and return this page class. */
  forcePageClass?: PageClass;
}

/**
 * Classify a Computer Runtime screenshot into the same PageClass vocabulary
 * as Playwright interstitial decide. No DOM — text DecisionPort + hints only.
 * Never auto-solves CAPTCHAs.
 *
 * Recheck + heuristic backend never auto-clears (returns unknown / escalate)
 * so Approve remains the reliable clear path without vision.
 */
export async function classifyComputerFrame(
  opts: ClassifyComputerFrameOptions
): Promise<PageClassDecision> {
  const phase = opts.phase ?? "assume_wall";
  const floor = opts.minConfidence ?? interstitialMinConfidence();

  if (opts.forcePageClass) {
    const heuristic = seedHeuristic(opts.reason, phase, opts.forcePageClass);
    return {
      pageClass: opts.forcePageClass,
      detection: pageClassToDetection(opts.forcePageClass, heuristic),
      confidence: 1,
      escalateHitl: opts.forcePageClass === "unknown",
      backend: "force",
      rationale: "forcePageClass",
    };
  }

  const decide = opts.decide ?? createDecisionPort();
  const heuristic = seedHeuristic(opts.reason, phase);

  // Heuristic backend cannot see pixels — never treat recheck as clear.
  if (phase === "recheck" && decide.backendName === "heuristic") {
    return {
      pageClass: "unknown",
      detection: {
        challenged: true,
        reason: "unknown",
        title: heuristic.title,
      },
      confidence: 0,
      escalateHitl: true,
      backend: decide.backendName,
      rationale:
        "computer-recheck: heuristic cannot see screenshot — wait for Approve",
    };
  }

  const snap = {
    source: "computer_screenshot",
    phase,
    evidencePath: opts.evidencePath,
    vncUrl: opts.vncUrl ?? null,
    suggestedClass: heuristicToSuggested(opts.reason, phase),
    title: heuristic.title ?? "",
    bodyText:
      phase === "recheck"
        ? "Desktop screenshot after possible human CAPTCHA/login. Classify: normal Reddit feed/post, login wall, CAPTCHA/humanity interstitial, rate limit, or unknown."
        : "Desktop screenshot of a Reddit challenge. Prefer the suggestedClass hint.",
    hasFeedContent: false,
    hasAuthModal: opts.reason === "login" && phase === "assume_wall",
    onAuthPath: opts.reason === "login" && phase === "assume_wall",
    heuristicChallenged: heuristic.challenged,
    heuristicReason: heuristic.reason,
  };

  const request = buildPageClassRequest(snap, floor);
  // Seed heuristic backend toward wall on first look (keyword match on id).
  if (phase === "assume_wall" && decide.backendName === "heuristic") {
    const choiceId = opts.reason === "login" ? "login" : "interstitial";
    request.meta = {
      ...request.meta,
      heuristic: { choiceId, confidence: Math.max(floor, 0.85) },
    };
  }

  let answer: DecisionAnswer;
  try {
    answer = await decide.decide(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[computer:classify] decide failed — escalate (${message})`);
    return {
      pageClass: "unknown",
      detection: {
        challenged: true,
        reason: heuristic.reason ?? "unknown",
        title: heuristic.title,
      },
      confidence: 0,
      escalateHitl: true,
      backend: decide.backendName,
      rationale: `decide-failed: ${message}`,
    };
  }

  return interpretPageClassAnswer(answer, heuristic, decide.backendName, floor);
}

export function isComputerPageClear(decision: PageClassDecision): boolean {
  return decision.pageClass === "feed" && !decision.detection.challenged;
}

export function isComputerRateLimited(decision: PageClassDecision): boolean {
  return decision.pageClass === "rate_limit";
}

function heuristicToSuggested(
  reason: "login" | "interstitial" | undefined,
  phase: ComputerFrameClassifyPhase
): PageClass {
  if (phase === "recheck") return "unknown";
  if (reason === "login") return "login";
  if (reason === "interstitial") return "interstitial";
  return "unknown";
}

function seedHeuristic(
  reason: "login" | "interstitial" | undefined,
  phase: ComputerFrameClassifyPhase,
  force?: PageClass
): InterstitialDetection {
  if (force === "feed") return { challenged: false, title: "computer-frame" };
  if (force === "rate_limit") {
    return { challenged: true, reason: "rate_limit", title: "computer-frame" };
  }
  if (force === "login") {
    return { challenged: true, reason: "login_wall", title: "computer-frame" };
  }
  if (force === "interstitial") {
    return {
      challenged: true,
      reason: "humanity_wall",
      title: "computer-frame",
    };
  }
  if (phase === "recheck") {
    return { challenged: true, reason: "unknown", title: "computer-frame" };
  }
  if (reason === "login") {
    return { challenged: true, reason: "login_wall", title: "computer-frame" };
  }
  return {
    challenged: true,
    reason: "humanity_wall",
    title: "computer-frame",
  };
}
