import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_PLAYBOOK } from "../src/policy/playbook.js";
import type { RedditListingPost } from "../src/reddit/client.js";
import {
  applyDeepReadEnrichment,
  hasUnknownCommentCount,
} from "../src/reddit/scout/extract-listing.js";
import { pickDeepReadCandidates } from "../src/reddit/scout/map-drafts.js";

function post(overrides: Partial<RedditListingPost> = {}): RedditListingPost {
  return {
    id: "abc",
    name: "t3_abc",
    subreddit: "femalefashionadvice",
    title: "How do I build a work capsule?",
    selftext: "Short",
    url: "https://www.reddit.com/r/femalefashionadvice/comments/abc",
    permalink: "https://www.reddit.com/r/femalefashionadvice/comments/abc",
    createdUtc: Math.floor(Date.now() / 1000),
    author: "op",
    ...overrides,
  };
}

describe("applyDeepReadEnrichment", () => {
  it("fills unknown numComments from thread deep-read", () => {
    const existing = post({ numComments: undefined, selftext: "Short" });
    assert.equal(hasUnknownCommentCount(existing), true);
    const changed = applyDeepReadEnrichment(existing, {
      selftext: "Much longer body with real wardrobe constraints and fit notes.",
      title: "How do I build a work capsule?",
      numComments: 17,
    });
    assert.equal(changed, true);
    assert.equal(existing.numComments, 17);
    assert.ok(existing.selftext.length > 20);
    assert.equal(hasUnknownCommentCount(existing), false);
  });

  it("updates stale comment counts from deep-read", () => {
    const existing = post({ numComments: 2 });
    assert.equal(
      applyDeepReadEnrichment(existing, { numComments: 30 }),
      true
    );
    assert.equal(existing.numComments, 30);
  });
});

describe("pickDeepReadCandidates unknown comments", () => {
  it("prioritizes thin help titles with unknown comment counts", () => {
    const unknownThin = post({
      id: "u1",
      title: "How should I style this for interviews?",
      selftext: "Help",
      numComments: undefined,
    });
    const knownThick = post({
      id: "k1",
      title: "Random title without help cues",
      selftext:
        "A long enough body that is not thin but also not a help ask for deep-read priority.",
      numComments: 4,
    });
    const picked = pickDeepReadCandidates([knownThick, unknownThin], 2, {
      playbookFor: () => DEFAULT_PLAYBOOK,
      kind: "help",
    });
    assert.equal(picked[0]?.id, "u1");
  });
});
