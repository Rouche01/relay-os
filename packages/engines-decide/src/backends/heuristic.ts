import type {
  ChoiceDecisionQuestion,
  DecisionAnswer,
  DecisionAnswerValue,
  DecisionCandidate,
  DecisionQuestion,
  DecisionRequest,
  NoulDecisionQuestion,
  ScoreDecisionQuestion,
} from "@relay/protocol";
import type { DecisionBackend } from "../types.js";

export interface HeuristicDecisionBackendOptions {
  /** Default overall confidence when not overridden via meta. */
  defaultConfidence?: number;
}

/**
 * Offline / CI backend. Keyword + fixture rules — never calls the network.
 *
 * Override via `request.meta.heuristic`:
 *   { confidence?, choiceId?, noulYes?, score? }
 */
export class HeuristicDecisionBackend implements DecisionBackend {
  readonly name = "heuristic";
  private readonly defaultConfidence: number;

  constructor(options: HeuristicDecisionBackendOptions = {}) {
    this.defaultConfidence = options.defaultConfidence ?? 0.85;
  }

  async decide(request: DecisionRequest): Promise<DecisionAnswer> {
    if (!request.questions.length) {
      throw new Error("DecisionRequest.questions must not be empty");
    }

    const stateText = stateToText(request.state);
    const overrides = readOverrides(request.meta);
    const answers: Record<string, DecisionAnswerValue> = {};
    const confidences: number[] = [];

    for (const question of request.questions) {
      const value = answerQuestion(question, stateText, overrides);
      answers[question.id] = value;
      confidences.push(confidenceFor(value, overrides.confidence));
    }

    const confidence =
      overrides.confidence ??
      (confidences.length ? Math.min(...confidences) : this.defaultConfidence);

    return {
      answers,
      confidence: clamp01(confidence),
      rationale: "heuristic backend",
    };
  }
}

interface HeuristicOverrides {
  confidence?: number;
  choiceId?: string;
  noulYes?: boolean;
  score?: number;
}

function readOverrides(meta: Record<string, unknown> | undefined): HeuristicOverrides {
  const raw = meta?.heuristic;
  if (!raw || typeof raw !== "object") return {};
  const h = raw as Record<string, unknown>;
  return {
    confidence: typeof h.confidence === "number" ? h.confidence : undefined,
    choiceId: typeof h.choiceId === "string" ? h.choiceId : undefined,
    noulYes: typeof h.noulYes === "boolean" ? h.noulYes : undefined,
    score: typeof h.score === "number" ? h.score : undefined,
  };
}

function answerQuestion(
  question: DecisionQuestion,
  stateText: string,
  overrides: HeuristicOverrides
): DecisionAnswerValue {
  switch (question.kind) {
    case "choice":
      return answerChoice(question, stateText, overrides.choiceId);
    case "noul":
      return answerNoul(question, stateText, overrides.noulYes);
    case "score":
      return answerScore(question, overrides.score);
  }
}

function answerChoice(
  question: ChoiceDecisionQuestion,
  stateText: string,
  forcedId?: string
): DecisionAnswerValue {
  const candidates = question.candidates;
  if (!candidates.length) {
    throw new Error(`choice question "${question.id}" has no candidates`);
  }

  const selected =
    (forcedId ? candidates.find((c) => c.id === forcedId) : undefined) ??
    pickByKeyword(candidates, stateText) ??
    candidates[0]!;

  const probabilities: Record<string, number> = {};
  for (const c of candidates) {
    probabilities[c.id] = c.id === selected.id ? 0.7 : 0.3 / Math.max(1, candidates.length - 1);
  }
  normalizeProbabilities(probabilities);

  return {
    kind: "choice",
    selectedId: selected.id,
    probabilities,
  };
}

function answerNoul(
  question: NoulDecisionQuestion,
  stateText: string,
  forced?: boolean
): DecisionAnswerValue {
  void question;
  const yes =
    forced ??
    (/\b(yes|fit|fits|match|matches|good|ok|safe)\b/i.test(stateText) &&
      !/\b(no|nsfw|spam|ban|unsafe|mismatch)\b/i.test(stateText));
  const probability = yes ? 0.82 : 0.18;
  return { kind: "noul", yes, probability };
}

function answerScore(
  question: ScoreDecisionQuestion,
  forced?: number
): DecisionAnswerValue {
  const min = question.min ?? 0;
  const max = question.max ?? 1;
  const mid = (min + max) / 2;
  const score = forced ?? mid;
  return { kind: "score", score: Math.min(max, Math.max(min, score)) };
}

function pickByKeyword(
  candidates: DecisionCandidate[],
  stateText: string
): DecisionCandidate | undefined {
  const lower = stateText.toLowerCase();
  return candidates.find(
    (c) =>
      lower.includes(c.id.toLowerCase()) ||
      lower.includes(c.label.toLowerCase()) ||
      (c.hint && lower.includes(c.hint.toLowerCase()))
  );
}

function confidenceFor(
  value: DecisionAnswerValue,
  override?: number
): number {
  if (override != null) return override;
  if (value.kind === "noul" && value.probability != null) {
    return Math.max(value.probability, 1 - value.probability);
  }
  if (value.kind === "choice" && value.probabilities) {
    return value.probabilities[value.selectedId] ?? 0.7;
  }
  return 0.7;
}

function stateToText(state: string | Record<string, unknown>): string {
  if (typeof state === "string") return state;
  try {
    return JSON.stringify(state);
  } catch {
    return String(state);
  }
}

function normalizeProbabilities(map: Record<string, number>): void {
  const sum = Object.values(map).reduce((a, b) => a + b, 0);
  if (sum <= 0) return;
  for (const key of Object.keys(map)) {
    map[key] = map[key]! / sum;
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
