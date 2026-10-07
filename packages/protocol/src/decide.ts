/**
 * Decide protocol — typed System-1 co-processor shapes.
 *
 * Apps observe / retrieve, then ask `@relay/engines-decide` (Jev or heuristic).
 * High-confidence safe answers may act or propose; low confidence and
 * irreversible paths escalate to an existing FeedbackRequest.
 *
 * Not an EngineType. Stages stay browser | llm | none | …; apps inject a
 * DecisionPort the same way they inject Playwright today.
 */

import type { FeedbackRequest, FeedbackType } from "./feedback";

/** One option a choice question may select among. Relay owns ids → locators. */
export interface DecisionCandidate {
  id: string;
  label: string;
  hint?: string;
}

export type DecisionQuestionKind = "choice" | "noul" | "score";

interface DecisionQuestionBase {
  id: string;
  kind: DecisionQuestionKind;
  /** Short question shown to the backend (and reused on escalate). */
  prompt: string;
}

export interface ChoiceDecisionQuestion extends DecisionQuestionBase {
  kind: "choice";
  candidates: DecisionCandidate[];
}

/** Yes/no (Noul) fit or rules-ok style question. */
export interface NoulDecisionQuestion extends DecisionQuestionBase {
  kind: "noul";
}

/** Numeric score in an optional range (defaults 0–1 after normalize). */
export interface ScoreDecisionQuestion extends DecisionQuestionBase {
  kind: "score";
  min?: number;
  max?: number;
  /**
   * Ordered rubric levels for Jev Score (low → high), 2–10 entries.
   * When omitted, backends may use a default scale.
   */
  levels?: string[];
}

export type DecisionQuestion =
  | ChoiceDecisionQuestion
  | NoulDecisionQuestion
  | ScoreDecisionQuestion;

/**
 * Hard policy evaluated in code, not in the model prompt.
 * Any irreversible / write / CAPTCHA / promote flag forces escalate.
 */
export interface DecisionPolicy {
  /** Floor for `act` (0–1). Default 0.75 when omitted. */
  minConfidence?: number;
  /** Comment submit, delete, destructive UI — always escalate. */
  destructive?: boolean;
  /** Network write that is not a read-only propose — always escalate. */
  networkWrite?: boolean;
  /** CAPTCHA / prove-humanity — escalate only; never auto-solve. */
  captchaOrHumanity?: boolean;
  /**
   * Allowlist promote to postable — always HITL.
   * Jev may only gate proposed; promote stays a discover choice.
   */
  promoteToPostable?: boolean;
  /** Feedback type when routing to escalate (default confirmation). */
  escalateFeedbackType?: Extract<
    FeedbackType,
    "choice" | "confirmation" | "approval"
  >;
}

/**
 * Observe / retrieve payload for the decide backend.
 * Prefer compact strings; objects are for structured discover/UI state.
 */
export interface DecisionRequest {
  state: string | Record<string, unknown>;
  questions: DecisionQuestion[];
  policy?: DecisionPolicy;
  /** Opaque app tags (e.g. meta.kind = discover | interstitial). */
  meta?: Record<string, unknown>;
}

export type DecisionAnswerValue =
  | {
      kind: "choice";
      selectedId: string;
      probabilities?: Record<string, number>;
    }
  | {
      kind: "noul";
      yes: boolean;
      /** P(yes) when the backend provides it. */
      probability?: number;
    }
  | {
      kind: "score";
      score: number;
    };

export interface DecisionAnswer {
  /** Per-question answers keyed by DecisionQuestion.id. */
  answers: Record<string, DecisionAnswerValue>;
  /** Overall confidence in [0, 1]. Router input, not proof of success. */
  confidence: number;
  rationale?: string;
}

/**
 * Router outcome after policy + confidence.
 * Discover "propose to allowlist" is an app-side act — still `"act"` here.
 */
export type DecisionRoute = "act" | "escalate" | "abort";

export const DEFAULT_MIN_CONFIDENCE = 0.75;

/** True when any hard-escalate policy bit is set. */
export function policyRequiresEscalate(policy?: DecisionPolicy): boolean {
  if (!policy) return false;
  return Boolean(
    policy.destructive ||
      policy.networkWrite ||
      policy.captchaOrHumanity ||
      policy.promoteToPostable
  );
}

/**
 * Map a decide answer + policy to act / escalate / abort.
 * Confidence alone never overrides hard policy.
 */
export function routeDecision(
  answer: DecisionAnswer,
  policy?: DecisionPolicy
): DecisionRoute {
  if (policyRequiresEscalate(policy)) return "escalate";

  const confidence = normalizeConfidence(answer.confidence);
  if (!Number.isFinite(confidence)) return "escalate";
  if (confidence < 0) return "abort";

  const floor = policy?.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  if (confidence < floor) return "escalate";
  return "act";
}

export interface DecisionEscalateInput {
  agentId: string;
  request: DecisionRequest;
  answer: DecisionAnswer;
  /** Override prompt; otherwise derived from the first question + rationale. */
  prompt?: string;
  /** Stable request id; random when omitted. */
  id?: string;
  required?: boolean;
  timeout_ms?: number;
}

/**
 * Build a FeedbackRequest for an escalate route.
 * Prefer choice options when the primary question is a choice; otherwise
 * confirmation / approval per policy.
 */
export function decisionToFeedbackRequest(
  input: DecisionEscalateInput
): FeedbackRequest {
  const primary = input.request.questions[0];
  const feedbackType =
    input.request.policy?.escalateFeedbackType ??
    (primary?.kind === "choice" ? "choice" : "confirmation");

  const options =
    feedbackType === "choice" && primary?.kind === "choice"
      ? primary.candidates.map((c) => c.label)
      : undefined;

  const prompt =
    input.prompt ??
    buildEscalatePrompt(primary, input.answer, input.request);

  return {
    id: input.id ?? createDecideRequestId(),
    agentId: input.agentId,
    type: feedbackType,
    prompt,
    required: input.required ?? true,
    options,
    timeout_ms: input.timeout_ms,
    context: {
      title: primary?.prompt,
      body: input.answer.rationale,
      details: [
        { label: "Route", value: "escalate" },
        {
          label: "Confidence",
          value: normalizeConfidence(input.answer.confidence).toFixed(3),
        },
        ...(primary
          ? [{ label: "Question", value: `${primary.kind}:${primary.id}` }]
          : []),
      ],
      meta: {
        ...(input.request.meta ?? {}),
        // Always last — app meta.kind (e.g. discover) must not mask escalate.
        kind: "decide_escalate",
        decision: {
          confidence: input.answer.confidence,
          answers: input.answer.answers,
          rationale: input.answer.rationale,
          policy: input.request.policy,
        },
        sourceKind: input.request.meta?.kind,
      },
    },
  };
}

function normalizeConfidence(n: number): number {
  if (!Number.isFinite(n)) return Number.NaN;
  if (n > 1 && n <= 100) return n / 100;
  return n;
}

function buildEscalatePrompt(
  primary: DecisionQuestion | undefined,
  answer: DecisionAnswer,
  request: DecisionRequest
): string {
  const bits: string[] = [];
  if (primary?.prompt) bits.push(primary.prompt);
  else bits.push("Decide layer needs a human.");

  const conf = normalizeConfidence(answer.confidence);
  if (Number.isFinite(conf)) {
    bits.push(`Model confidence ${conf.toFixed(2)}.`);
  }
  if (answer.rationale) bits.push(answer.rationale);

  if (policyRequiresEscalate(request.policy)) {
    bits.push("Hard policy requires human approval before continuing.");
  }

  return bits.join(" ");
}

function createDecideRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `decide-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
