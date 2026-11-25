import type { LlmClient } from "@relay/llm";
import type { CommunityDraft } from "../types.js";
import type { DraftEvalCase } from "./draft-cases.js";

export interface DraftJudgeScores {
  threadFit: number;
  soundsHuman: number;
  specificity: number;
  /**
   * 1-5 how well the reply matches lane persona (peer judgment vs stylist funnel).
   * Help: concrete peer, one take, no frameworks. Presence: glance, not consult.
   */
  personaFit: number;
  rationale?: string;
}

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
    personaFit: {
      type: "integer",
      description:
        "1-5 peer wardrobe voice vs stylist funnel / same-y coach (lane persona)",
    },
    rationale: {
      type: "string",
      description: "One short sentence on the scores",
    },
  },
  required: ["threadFit", "soundsHuman", "specificity", "personaFit"],
};

function clampScore(n: unknown): number | null {
  const v = typeof n === "number" ? n : typeof n === "string" ? Number(n) : NaN;
  if (!Number.isFinite(v)) return null;
  return Math.max(1, Math.min(5, Math.round(v)));
}

/**
 * Advisory LLM judge (optional). Does not gate approve/execute.
 */
export async function judgeDraft(input: {
  client: LlmClient;
  evalCase: DraftEvalCase;
  draft: CommunityDraft;
}): Promise<DraftJudgeScores> {
  const kind = input.evalCase.kind ?? "help";
  const personaRubric =
    kind === "presence"
      ? [
          "personaFit (presence): score high for a short glance (compliment + one noticed detail).",
          "Score low for coaching, systems talk, multi-sentence advice essays, or product plugs.",
        ]
      : [
          "personaFit (help): score high for a practical wardrobe peer: one strong take, grounded judgment,",
          "  asks when context is missing instead of guessing, no stylist funnel.",
          "Score low for numbered frameworks, capsule sermons that fit any post, Happy-to-help openers,",
          "  or invented personal stories / shops / prices.",
        ];

  const prompt = [
    "Score this Reddit fashion reply for an offline eval. Be strict about AI/coach tone.",
    "Return JSON only matching the schema (scores 1-5).",
    "",
    ...personaRubric,
    "",
    `Lane: ${kind}`,
    `Subreddit: r/${input.evalCase.subreddit}`,
    `Title: ${input.evalCase.threadTitle}`,
    `OP: ${input.evalCase.opText || "(empty)"}`,
    input.evalCase.opMediaHint
      ? `Media hint: ${input.evalCase.opMediaHint}`
      : "",
    "",
    "Draft:",
    input.draft.draftText,
  ]
    .filter(Boolean)
    .join("\n");

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
  const personaFit = clampScore(parsed.personaFit);
  if (
    threadFit == null ||
    soundsHuman == null ||
    specificity == null ||
    personaFit == null
  ) {
    throw new Error("judge scores missing or invalid");
  }

  return {
    threadFit,
    soundsHuman,
    specificity,
    personaFit,
    rationale:
      typeof parsed.rationale === "string" ? parsed.rationale.trim() : undefined,
  };
}
