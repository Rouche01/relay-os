import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { DRAFT_EVAL_CASES } from "../src/eval/draft-cases.js";
import {
  scoreDraft,
  SHARED_AI_TELL_PHRASES,
} from "../src/eval/draft-score.js";
import { draftReply } from "../src/stages/draft/drafter.js";
import type { CommunityDraft } from "../src/types.js";

const savedGemini = process.env.GEMINI_API_KEY;
const savedAnthropic = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  if (savedGemini === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = savedGemini;
  if (savedAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedAnthropic;
});

function draft(over: Partial<CommunityDraft> = {}): CommunityDraft {
  return {
    id: "eval-test",
    platform: "reddit",
    subreddit: "fashion",
    threadUrl: "https://reddit.com/r/fashion/comments/x",
    threadTitle: "Test title",
    opText: "body",
    draftText: "A helpful reply about the ask.",
    intensity: 0,
    score: {
      problemFit: true,
      wantsHelp: true,
      rulesOk: true,
      freshnessOk: true,
      valueWithoutApp: true,
      competition: true,
      icpFit: true,
      plugNaturalness: false,
    },
    rationale: "t",
    status: "pending_approval",
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe("scoreDraft", () => {
  const baseCase = DRAFT_EVAL_CASES[0]!;

  it("fails on em dashes and banned AI tells", () => {
    const scored = scoreDraft(
      draft({
        draftText:
          "From the pic, yeah — you'd want a mid rise. Happy to help unpack this.",
      }),
      { ...baseCase, mustGroundIn: ["rise"] }
    );
    assert.equal(scored.ok, false);
    assert.ok(scored.findings.some((f) => f.id === "em_dash"));
    assert.ok(scored.findings.some((f) => f.id === "banned_phrase"));
  });

  it("fails when grounding tokens are missing", () => {
    const scored = scoreDraft(draft({ draftText: "Totally generic advice." }), {
      ...baseCase,
      mustGroundIn: ["capsule", "warehouse"],
    });
    assert.equal(scored.ok, false);
    assert.ok(scored.findings.some((f) => f.id === "grounding"));
  });

  it("fails product plugs when help-only is expected", () => {
    const scored = scoreDraft(
      draft({
        draftText: "Try neutrals. GoStylens can help track gaps.",
        intensity: 1,
      }),
      { ...baseCase, forceIntensity0: true, mustGroundIn: ["neutral"] }
    );
    assert.equal(scored.ok, false);
    assert.ok(scored.findings.some((f) => f.id === "product_help_only"));
  });

  it("passes a clean grounded help-only reply", () => {
    const scored = scoreDraft(
      draft({
        draftText:
          "For a work capsule I'd start with what still fits and one constraint (comfort or polish). Then fill gaps slowly.",
        intensity: 0,
      }),
      { ...baseCase, mustGroundIn: ["capsule", "work"], forceIntensity0: true }
    );
    assert.equal(scored.ok, true);
  });

  it("exports a non-empty shared ban list", () => {
    assert.ok(SHARED_AI_TELL_PHRASES.length >= 5);
  });
});

describe("draft eval stub smoke", () => {
  it("scores all cases against stub drafts without hard fails", async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    for (const evalCase of DRAFT_EVAL_CASES) {
      const outcome = await draftReply(
        {
          id: `eval-${evalCase.id}`,
          platform: "reddit",
          subreddit: evalCase.subreddit,
          threadUrl: `https://reddit.com/r/${evalCase.subreddit}/comments/eval`,
          threadTitle: evalCase.threadTitle,
          opText: evalCase.opText,
          ...(evalCase.opMediaHint
            ? { opMediaHint: evalCase.opMediaHint }
            : {}),
          draftText: "",
          intensity: evalCase.intensity ?? 0,
          score: {
            problemFit: true,
            wantsHelp: true,
            rulesOk: true,
            freshnessOk: true,
            valueWithoutApp: true,
            competition: true,
            icpFit: true,
            plugNaturalness: false,
          },
          rationale: "eval",
          status: "proposed",
          createdAt: new Date().toISOString(),
        },
        {
          forceIntensity0: evalCase.forceIntensity0,
          intensity: evalCase.intensity,
        }
      );
      const scored = scoreDraft(outcome.draft, evalCase);
      assert.equal(
        scored.ok,
        true,
        `${evalCase.id}: ${scored.findings.map((f) => f.message).join("; ")}`
      );
      assert.doesNotMatch(outcome.draft.draftText, /[—–]/);
    }
  });
});
