import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { draftToFeedbackContext } from "../src/decide/feedback-map.js";
import {
  formatManualPostNotify,
  truncateTitle,
} from "../src/stages/execute/manual-notify.js";
import type { CommunityDraft } from "../src/types.js";

function sampleDraft(over: Partial<CommunityDraft> = {}): CommunityDraft {
  return {
    id: "reddit-manual1",
    platform: "reddit",
    subreddit: "femalefashionadvice",
    threadUrl: "https://www.reddit.com/r/femalefashionadvice/comments/abc/title/",
    threadTitle: "How do I build a capsule wardrobe?",
    draftText: "Start with neutrals and five pieces that mix.",
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
    rationale: "test",
    status: "approved",
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe("formatManualPostNotify", () => {
  it("includes permalink, score, and copy block", () => {
    const text = formatManualPostNotify(sampleDraft());
    assert.match(text, /Manual post · r\/femalefashionadvice/);
    assert.match(text, /Score 7\/8/);
    assert.match(text, /help-only/);
    assert.match(
      text,
      /https:\/\/www\.reddit\.com\/r\/femalefashionadvice\/comments\/abc\/title\//
    );
    assert.match(text, /Suggested reply \(copy\/paste\):/);
    assert.match(text, /Start with neutrals/);
    assert.match(text, /no automated comment will be sent/i);
  });

  it("truncates long titles", () => {
    const long = "x".repeat(200);
    assert.ok(truncateTitle(long).endsWith("…"));
    assert.ok(truncateTitle(long).length <= 120);
  });
});

describe("draftToFeedbackContext postMode=manual", () => {
  it("marks meta and post-mode detail", () => {
    const ctx = draftToFeedbackContext(sampleDraft(), { postMode: "manual" });
    assert.equal(ctx.meta?.postMode, "manual");
    assert.ok(
      ctx.details?.some(
        (d) => d.label === "Post mode" && /manual/.test(d.value)
      )
    );
  });
});
