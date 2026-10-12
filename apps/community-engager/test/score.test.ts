import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RedditListingPost } from "../src/reddit/client.js";
import {
  COMPETITION_MAX_COMMENTS,
  scoreCompetition,
  scoreRedditPost,
} from "../src/reddit/scout/score.js";
import {
  ACTIONABLE_SCORE_MIN,
  isActionable,
  SCORE_MAX,
  scoreTotal,
} from "../src/types.js";

function post(overrides: Partial<RedditListingPost> = {}): RedditListingPost {
  return {
    id: "abc",
    name: "t3_abc",
    subreddit: "femalefashionadvice",
    title: "How do I build a work capsule when nothing fits?",
    selftext:
      "I keep buying pieces that do not work together. Looking for a simple system, not brand recs.",
    url: "https://www.reddit.com/r/femalefashionadvice/comments/abc",
    permalink: "https://www.reddit.com/r/femalefashionadvice/comments/abc",
    createdUtc: Math.floor(Date.now() / 1000),
    author: "op",
    numComments: 3,
    ...overrides,
  };
}

describe("scoreCompetition", () => {
  it("is true when comment count is unknown", () => {
    assert.equal(scoreCompetition(post({ numComments: undefined })), true);
  });

  it("is true at or below the max", () => {
    assert.equal(
      scoreCompetition(post({ numComments: COMPETITION_MAX_COMMENTS })),
      true
    );
  });

  it("is false when the thread is crowded", () => {
    assert.equal(
      scoreCompetition(post({ numComments: COMPETITION_MAX_COMMENTS + 1 })),
      false
    );
  });
});

describe("scoreRedditPost richer dimensions", () => {
  it("scores a capsule/system ask as actionable (high /8)", () => {
    const { score, rationale } = scoreRedditPost(post());
    assert.equal(score.problemFit, true);
    assert.equal(score.icpFit, true);
    assert.equal(score.competition, true);
    assert.equal(score.plugNaturalness, true);
    assert.ok(scoreTotal(score) >= ACTIONABLE_SCORE_MIN);
    assert.ok(isActionable(score));
    assert.match(rationale, /ICP fit/);
    assert.match(rationale, new RegExp(`/${SCORE_MAX}`));
  });

  it("fails competition when crowded", () => {
    const { score } = scoreRedditPost(
      post({ numComments: COMPETITION_MAX_COMMENTS + 5 })
    );
    assert.equal(score.competition, false);
  });

  it("marks haul/flex as weak ICP and unnatural plug", () => {
    const { score } = scoreRedditPost(
      post({
        title: "Rate my thrift haul 🔥",
        selftext: "Just showing off finds, no questions.",
        subreddit: "fashion",
      })
    );
    assert.equal(score.icpFit, false);
    assert.equal(score.plugNaturalness, false);
    assert.equal(score.problemFit, false);
    assert.ok(!isActionable(score));
  });

  it("does not treat a generic how-should ask as ICP without wardrobe language", () => {
    const { score } = scoreRedditPost(
      post({
        title: "How should I style this blazer for a wedding?",
        selftext: "Any ideas on shoes? Please help.",
        numComments: 2,
      })
    );
    assert.equal(score.wantsHelp, true);
    assert.equal(score.icpFit, false);
  });

  it("keeps SCORE_MAX at 8 dimensions", () => {
    assert.equal(SCORE_MAX, 8);
    assert.equal(ACTIONABLE_SCORE_MIN, 5);
  });
});
