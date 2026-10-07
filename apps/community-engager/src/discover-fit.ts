import type { DecisionPort } from "@relay/engines-decide";
import {
  discoverMinConfidence,
  withMinConfidence,
} from "@relay/engines-decide";
import type { DecisionAnswer, DecisionRequest } from "@relay/protocol";

export const DEFAULT_DISCOVER_GOAL =
  "Help-first fashion and styling communities for GoStylens. Soft product mention OK when useful; never hard-sell or spam.";

/** Below this, drop without a second look. */
export const DISCOVER_FIT_DROP_BELOW = 0.45;

export interface DiscoverFitInput {
  name: string;
  title: string;
  publicDescription: string;
  subscribers: number;
  sampleTitles?: string[];
  goal: string;
}

export interface DiscoverFitResult {
  /** Propose only when true (Noul yes + confidence ≥ floor). */
  propose: boolean;
  /** Whether a second look with sample titles is worth it. */
  wantSamples: boolean;
  fitYes: boolean;
  rulesOk: boolean;
  confidence: number;
  fitScore: number;
  note: string;
  evidence: string;
  backend: string;
}

/**
 * Score one discovery candidate via DecisionPort (Noul fit + rules).
 * Never promotes to postable — caller may only upsertProposed.
 */
export async function scoreDiscoverFit(
  port: DecisionPort,
  input: DiscoverFitInput,
  opts?: { minConfidence?: number }
): Promise<DiscoverFitResult> {
  const floor = opts?.minConfidence ?? discoverMinConfidence();
  const request = buildDiscoverFitRequest(input, floor);
  let answer: DecisionAnswer;
  try {
    answer = await port.decide(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[discover] decide failed for r/${input.name}: ${message}`);
    return {
      propose: false,
      wantSamples: false,
      fitYes: false,
      rulesOk: false,
      confidence: 0,
      fitScore: 0,
      note: `Decide failed — skipped (${message})`,
      evidence: `decide_error; backend=${port.backendName}`,
      backend: port.backendName,
    };
  }

  return interpretDiscoverFit(answer, port.backendName, floor, input);
}

export function buildDiscoverFitRequest(
  input: DiscoverFitInput,
  minConfidence: number
): DecisionRequest {
  const samples = (input.sampleTitles ?? []).filter(Boolean).slice(0, 12);
  const state = {
    goal: input.goal,
    subreddit: input.name,
    title: input.title,
    publicDescription: input.publicDescription.slice(0, 800),
    subscribers: input.subscribers,
    ...(samples.length ? { sampleTitles: samples } : {}),
  };

  return {
    state,
    questions: [
      {
        id: "fit",
        kind: "noul",
        prompt:
          "Does this subreddit fit the community goal for help-first fashion/styling engagement?",
      },
      {
        id: "rules",
        kind: "noul",
        prompt:
          "Do the public description and vibe look OK for soft help and an occasional soft product mention (not hard spam)?",
      },
    ],
    policy: withMinConfidence({}, minConfidence),
    meta: { kind: "discover" },
  };
}

export function interpretDiscoverFit(
  answer: DecisionAnswer,
  backend: string,
  floor: number,
  input: DiscoverFitInput
): DiscoverFitResult {
  const fit = answer.answers.fit;
  const rules = answer.answers.rules;
  const fitYes = fit?.kind === "noul" ? fit.yes : false;
  const rulesOk = rules?.kind === "noul" ? rules.yes : true;
  const confidence = clamp01(answer.confidence);
  const fitScore = Math.round(confidence * 10);
  const hasSamples = (input.sampleTitles?.length ?? 0) > 0;

  const wantSamples =
    !hasSamples &&
    confidence >= DISCOVER_FIT_DROP_BELOW &&
    confidence < floor;

  const propose = fitYes && confidence >= floor;

  const note = propose
    ? rulesOk
      ? "Decide: fits goal; soft mention looks OK — human must still promote."
      : "Decide: fits goal but rules look risky — help-only if promoted."
    : fitYes
      ? `Decide: fit signal but confidence ${confidence.toFixed(2)} below floor ${floor.toFixed(2)}.`
      : "Decide: does not fit community goal.";

  const evidence = [
    `backend=${backend}`,
    `confidence=${confidence.toFixed(3)}`,
    `fit=${fitYes}`,
    `rulesOk=${rulesOk}`,
    `subs=${input.subscribers}`,
    `samples=${input.sampleTitles?.length ?? 0}`,
    propose ? "propose" : wantSamples ? "want_samples" : "drop",
  ].join("; ");

  return {
    propose,
    wantSamples,
    fitYes,
    rulesOk,
    confidence,
    fitScore,
    note,
    evidence,
    backend,
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
