import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { mergeConfig, resetAppConfigCache } from "../src/app-config.js";
import type { RedditListingPost } from "../src/reddit/client.js";
import {
  getCommunityConfig,
  parsePostMode,
} from "../src/reddit/config.js";
import { RedditApisClient } from "../src/reddit/redditapis/client.js";
import { scoutRedditApis } from "../src/reddit/scout/scout-redditapis.js";
import { scoutOpportunities } from "../src/stages/scout/scout.js";

function samplePost(id: string): RedditListingPost {
  return {
    id,
    name: `t3_${id}`,
    subreddit: "femalefashionadvice",
    title: "How do I build a capsule wardrobe from scratch?",
    selftext:
      "I need a system for outfits and planning — looking for feedback, not brand spam.",
    url: `https://www.reddit.com/r/femalefashionadvice/comments/${id}/capsule/`,
    permalink: `https://www.reddit.com/r/femalefashionadvice/comments/${id}/capsule/`,
    createdUtc: Math.floor(Date.now() / 1000) - 3600,
    author: "op_user",
    numComments: 2,
  };
}

describe("scoutRedditApis", () => {
  afterEach(() => {
    resetAppConfigCache();
    delete process.env.REDDITAPIS_API_KEY;
    delete process.env.SCOUT_SOURCE;
  });

  it("maps listings through listingPostsToDrafts", async () => {
    process.env.REDDITAPIS_API_KEY = "test-key";
    const cfg = getCommunityConfig(process.env, {
      appConfig: mergeConfig({ scout: { delayMs: 0 } }),
    });
    assert.equal(cfg.redditApis.configured, true);

    const client = {
      listNew: async () => [samplePost("apiscout1")],
    } as unknown as RedditApisClient;

    const drafts = await scoutRedditApis({
      cfg,
      client,
      subreddits: ["femalefashionadvice"],
      limit: 3,
      delayMs: 0,
    });
    assert.ok(drafts.length >= 1);
    assert.equal(drafts[0]!.id, "reddit-apiscout1");
    assert.equal(drafts[0]!.subreddit, "femalefashionadvice");
  });

  it("throws when key missing", async () => {
    const cfg = getCommunityConfig({}, { appConfig: mergeConfig({}) });
    assert.equal(cfg.redditApis.configured, false);
    await assert.rejects(
      () => scoutRedditApis({ cfg, subreddits: ["test"], delayMs: 0 }),
      /REDDITAPIS_API_KEY/
    );
  });
});

describe("scoutOpportunities + redditapis", () => {
  afterEach(() => {
    resetAppConfigCache();
    delete process.env.REDDITAPIS_API_KEY;
    delete process.env.SCOUT_SOURCE;
  });

  it("parseScoutSource accepts redditapis via getCommunityConfig", () => {
    const cfg = getCommunityConfig(
      { SCOUT_SOURCE: "redditapis", REDDITAPIS_API_KEY: "k" },
      { appConfig: mergeConfig({}) }
    );
    assert.equal(cfg.scout.source, "redditapis");
    assert.equal(parsePostMode("manual"), "manual");
  });

  it("explicit redditapis without key throws", async () => {
    await assert.rejects(
      () =>
        scoutOpportunities({
          source: "redditapis",
          subreddits: ["test"],
          limit: 1,
        }),
      /REDDITAPIS_API_KEY/
    );
  });
});
