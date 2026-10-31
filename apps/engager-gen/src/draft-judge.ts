import type { LlmClient } from "@relay/llm";

/** Same soft-judge dimensions as CommunityEngager `eval/draft-judge`. */
export type DraftJudgeScores = {
  threadFit: number;
  soundsHuman: number;
  specificity: number;
  rationale?: string;
};

export type ParityDraftCase = {
  id: string;
  subreddit: string;
  threadTitle: string;
  opText: string;
  /** engager-gen / Spec-host draft text under test. */
  genDraft: string;
  /** CE-quality baseline draft for the same thread (parity target). */
  ceDraft: string;
};

const JUDGE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    threadFit: {
      type: "integer",
      description: "1-5 how well the reply fits this thread",
    },
    soundsHuman: {
      type: "integer",
      description: "1-5 how casual/human vs AI/coach/retail",
    },
    specificity: {
      type: "integer",
      description: "1-5 how concrete and grounded in the post",
    },
    rationale: {
      type: "string",
      description: "One short sentence on the scores",
    },
  },
  required: ["threadFit", "soundsHuman", "specificity"],
};

function clampScore(n: unknown): number | null {
  const v = typeof n === "number" ? n : typeof n === "string" ? Number(n) : NaN;
  if (!Number.isFinite(v)) return null;
  return Math.max(1, Math.min(5, Math.round(v)));
}

export function meanJudgeScore(scores: DraftJudgeScores): number {
  return (scores.threadFit + scores.soundsHuman + scores.specificity) / 3;
}

/**
 * Advisory soft judge — mirrors CE `judgeDraft` so parity deltas are comparable.
 */
export async function judgeDraft(input: {
  client: LlmClient;
  evalCase: Pick<
    ParityDraftCase,
    "subreddit" | "threadTitle" | "opText"
  >;
  draftText: string;
}): Promise<DraftJudgeScores> {
  const prompt = [
    "Score this Reddit fashion reply for an offline eval. Be strict about AI/coach tone.",
    "Return JSON only matching the schema (scores 1-5).",
    "",
    `Subreddit: r/${input.evalCase.subreddit}`,
    `Title: ${input.evalCase.threadTitle}`,
    `OP: ${input.evalCase.opText || "(empty)"}`,
    "",
    "Draft:",
    input.draftText,
  ].join("\n");

  const result = await input.client.completeJson({
    messages: [{ role: "user", content: prompt }],
    schema: JUDGE_SCHEMA,
    temperature: 0.2,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(result.text) as Record<string, unknown>;
  } catch {
    throw new Error("judge JSON parse failed");
  }

  const threadFit = clampScore(parsed.threadFit);
  const soundsHuman = clampScore(parsed.soundsHuman);
  const specificity = clampScore(parsed.specificity);
  if (threadFit == null || soundsHuman == null || specificity == null) {
    throw new Error("judge scores missing or invalid");
  }

  return {
    threadFit,
    soundsHuman,
    specificity,
    rationale:
      typeof parsed.rationale === "string" ? parsed.rationale.trim() : undefined,
  };
}
