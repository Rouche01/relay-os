import type {
  ChoiceDecisionQuestion,
  DecisionAnswer,
  DecisionAnswerValue,
  DecisionQuestion,
  DecisionRequest,
  ScoreDecisionQuestion,
} from "@relay/protocol";
import type { DecisionBackend } from "../types.js";

/** Official TypeSafe evaluation endpoint. */
export const DEFAULT_JEV_BASE_URL = "https://api.typesafe.ai/v1/systemone";

export interface JevDecisionBackendOptions {
  apiKey?: string;
  /** Full POST URL (systemone or hosted /api/v1/decide). */
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

interface JevQuestionBody {
  type: "choice" | "noul" | "score";
  instructions: string;
  criteria?: Record<string, string | null> | string[];
}

interface JevNoulAnswer {
  type: "noul";
  noul: number;
}

interface JevChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

interface JevScoreAnswer {
  type: "score";
  score: number;
  legend?: Record<string, string>;
  probabilities?: Record<string, number>;
  confidence: number;
}

type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer;

interface JevResponseBody {
  model?: string;
  answers?: Record<string, JevAnswer>;
  error?: string | { message?: string };
}

/**
 * TypeSafe Jev HTTP client (Choice / Noul / Score).
 * Live network only — CI should use HeuristicDecisionBackend.
 */
export class JevDecisionBackend implements DecisionBackend {
  readonly name = "jev";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: JevDecisionBackendOptions = {}) {
    const apiKey = (options.apiKey ?? process.env.JEV_API_KEY ?? "").trim();
    if (!apiKey) {
      throw new Error("JevDecisionBackend requires JEV_API_KEY");
    }
    this.apiKey = apiKey;
    this.baseUrl = (
      options.baseUrl ??
      process.env.JEV_BASE_URL ??
      DEFAULT_JEV_BASE_URL
    ).replace(/\/$/, "");
    this.model = options.model ?? process.env.JEV_MODEL ?? "jev-latest";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async decide(request: DecisionRequest): Promise<DecisionAnswer> {
    if (!request.questions.length) {
      throw new Error("DecisionRequest.questions must not be empty");
    }

    const questions: Record<string, JevQuestionBody> = {};
    for (const q of request.questions) {
      questions[q.id] = toJevQuestion(q);
    }

    const res = await this.fetchImpl(this.baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        state: request.state,
        questions,
      }),
    });

    const text = await res.text();
    let body: JevResponseBody;
    try {
      body = text ? (JSON.parse(text) as JevResponseBody) : {};
    } catch {
      throw new Error(`Jev returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
    }

    if (!res.ok) {
      const errMsg =
        typeof body.error === "string"
          ? body.error
          : body.error?.message ?? text.slice(0, 200);
      throw new Error(`Jev HTTP ${res.status}: ${errMsg}`);
    }

    if (!body.answers) {
      throw new Error("Jev response missing answers");
    }

    return mapJevAnswers(request.questions, body.answers, body.model);
  }
}

function toJevQuestion(question: DecisionQuestion): JevQuestionBody {
  switch (question.kind) {
    case "choice":
      return {
        type: "choice",
        instructions: question.prompt,
        criteria: choiceCriteria(question),
      };
    case "noul":
      return {
        type: "noul",
        instructions: question.prompt,
      };
    case "score":
      return {
        type: "score",
        instructions: question.prompt,
        criteria: scoreLevels(question),
      };
  }
}

function choiceCriteria(
  question: ChoiceDecisionQuestion
): Record<string, string | null> {
  const criteria: Record<string, string | null> = {};
  for (const c of question.candidates) {
    criteria[c.id] = c.hint ?? c.label ?? null;
  }
  return criteria;
}

function scoreLevels(question: ScoreDecisionQuestion): string[] {
  if (Array.isArray(question.levels) && question.levels.length >= 2) {
    return question.levels;
  }
  return ["low", "medium", "high"];
}

function mapJevAnswers(
  questions: DecisionQuestion[],
  raw: Record<string, JevAnswer>,
  model?: string
): DecisionAnswer {
  const answers: Record<string, DecisionAnswerValue> = {};
  const confidences: number[] = [];

  for (const q of questions) {
    const row = raw[q.id];
    if (!row) {
      throw new Error(`Jev response missing answer for question "${q.id}"`);
    }
    const mapped = mapOneAnswer(q, row);
    answers[q.id] = mapped.value;
    confidences.push(mapped.confidence);
  }

  return {
    answers,
    confidence: confidences.length ? Math.min(...confidences) : 0,
    rationale: model ? `jev:${model}` : "jev",
  };
}

function mapOneAnswer(
  question: DecisionQuestion,
  row: JevAnswer
): { value: DecisionAnswerValue; confidence: number } {
  if (question.kind === "noul") {
    if (row.type !== "noul") {
      throw new Error(`Expected noul answer for "${question.id}", got ${row.type}`);
    }
    const p = clamp01(row.noul);
    return {
      value: { kind: "noul", yes: p >= 0.5, probability: p },
      confidence: Math.max(p, 1 - p),
    };
  }

  if (question.kind === "choice") {
    if (row.type !== "choice") {
      throw new Error(`Expected choice answer for "${question.id}", got ${row.type}`);
    }
    return {
      value: {
        kind: "choice",
        selectedId: row.choice,
        probabilities: row.probabilities,
      },
      confidence: clamp01(row.confidence),
    };
  }

  if (row.type !== "score") {
    throw new Error(`Expected score answer for "${question.id}", got ${row.type}`);
  }
  const levels = scoreLevels(question);
  const maxIndex = Math.max(1, levels.length - 1);
  const normalized = clamp01(row.score / maxIndex);
  return {
    value: { kind: "score", score: normalized },
    confidence: clamp01(row.confidence),
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
