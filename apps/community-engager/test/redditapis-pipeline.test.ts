import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapRedditApisPosts } from "../src/reddit/redditapis/map-post.js";
import { listingPostsToDrafts } from "../src/reddit/scout/map-drafts.js";
import { DEFAULT_PLAYBOOK } from "../src/policy/playbook.js";

/**
 * Docs/rollout golden path: redditapis JSON → RedditListingPost → actionable draft.
 */
describe("redditapis → listingPostsToDrafts pipeline", () => {
  it("drops posts older than maxAgeHours", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const posts = mapRedditApisPosts([
      {
        id: "old1",
        name: "t3_old1",
        title: "How do I build a capsule wardrobe system?",
        author: "op",
        permalink: "/r/femalefashionadvice/comments/old1/capsule/",
        text: "I need a process for outfits that work together — looking for advice.",
        subreddit: "femalefashionadvice",
        comments: 1,
        created_utc: nowSec - 8 * 3600,
      },
      {
        id: "new1",
        name: "t3_new1",
        title: "How do I build a capsule wardrobe system?",
        author: "op",
        permalink: "/r/femalefashionadvice/comments/new1/capsule/",
        text: "I need a process for outfits that work together — looking for advice.",
        subreddit: "femalefashionadvice",
        comments: 1,
        created_utc: nowSec - 3600,
      },
    ]);
    const drafts = listingPostsToDrafts(posts, 5, {
      playbookFor: () => DEFAULT_PLAYBOOK,
      maxAgeHours: 6,
      nowMs: Date.now(),
    });
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]!.id, "reddit-new1");
  });

  it("produces an actionable draft from a help-shaped listing post", () => {
    const posts = mapRedditApisPosts([
      {
        id: "pipe1",
        name: "t3_pipe1",
        title: "How do I build a capsule wardrobe system?",
        author: "op",
        permalink: "/r/femalefashionadvice/comments/pipe1/capsule/",
        text:
          "I need a process for outfits that work together — looking for advice, not a haul.",
        subreddit: "femalefashionadvice",
        comments: 2,
        created_utc: Math.floor(Date.now() / 1000) - 3600,
      },
    ]);
    assert.equal(posts.length, 1);
    assert.equal(posts[0]!.selftext.includes("process"), true);
    assert.equal(posts[0]!.numComments, 2);

    const drafts = listingPostsToDrafts(posts, 5, {
      playbookFor: () => DEFAULT_PLAYBOOK,
    });
    assert.ok(
      drafts.length >= 1,
      "expected ≥1 actionable draft from capsule/system help post"
    );
    assert.equal(drafts[0]!.id, "reddit-pipe1");
    assert.equal(drafts[0]!.subreddit, "femalefashionadvice");
    assert.match(drafts[0]!.threadUrl, /reddit\.com/);
  });
});
