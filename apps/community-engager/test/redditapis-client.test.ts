import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  mapRedditApisPost,
  mapRedditApisPosts,
  normalizeRedditPermalink,
  RedditApisClient,
} from "../src/reddit/redditapis/index.js";
import { getCommunityConfig } from "../src/reddit/config.js";
import { mergeConfig, resetAppConfigCache } from "../src/app-config.js";

describe("redditapis map-post", () => {
  it("normalizes relative permalinks", () => {
    assert.equal(
      normalizeRedditPermalink("/r/test/comments/abc/title/"),
      "https://www.reddit.com/r/test/comments/abc/title/"
    );
    assert.equal(
      normalizeRedditPermalink("https://reddit.com/r/x/comments/1/"),
      "https://reddit.com/r/x/comments/1/"
    );
  });

  it("maps text → selftext and comments → numComments", () => {
    const mapped = mapRedditApisPost({
      id: "1abc",
      name: "t3_1abc",
      title: "Hello",
      author: "op",
      permalink: "/r/femalefashionadvice/comments/1abc/hello/",
      url: "https://www.reddit.com/r/femalefashionadvice/comments/1abc/hello/",
      text: "I need wardrobe help",
      subreddit: "femalefashionadvice",
      comments: 12,
      created_utc: 1_700_000_000,
    });
    assert.ok(mapped);
    assert.equal(mapped!.id, "1abc");
    assert.equal(mapped!.selftext, "I need wardrobe help");
    assert.equal(mapped!.numComments, 12);
    assert.equal(
      mapped!.permalink,
      "https://www.reddit.com/r/femalefashionadvice/comments/1abc/hello/"
    );
    assert.equal(mapped!.subreddit, "femalefashionadvice");
  });

  it("skips posts without id", () => {
    assert.equal(mapRedditApisPosts([{ title: "no id" }]).length, 0);
  });
});

describe("RedditApisClient", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetAppConfigCache();
    delete process.env.REDDITAPIS_API_KEY;
    delete process.env.REDDITAPIS_BASE_URL;
  });

  it("getCommunityConfig exposes redditApis from env", () => {
    const cfg = getCommunityConfig(
      {
        REDDITAPIS_API_KEY: " test-key ",
        REDDITAPIS_BASE_URL: "https://api.example.com/",
      },
      { appConfig: mergeConfig({}) }
    );
    assert.equal(cfg.redditApis.configured, true);
    assert.equal(cfg.redditApis.apiKey, "test-key");
    assert.equal(cfg.redditApis.baseUrl, "https://api.example.com");
  });

  it("sends Bearer key and maps listing response", async () => {
    let seenUrl = "";
    let seenAuth = "";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = String(input);
      seenAuth = String(
        new Headers(init?.headers).get("Authorization") ?? ""
      );
      return new Response(
        JSON.stringify({
          posts: [
            {
              id: "xyz",
              name: "t3_xyz",
              title: "Fit check",
              author: "u1",
              permalink: "/r/test/comments/xyz/fit/",
              text: "body",
              subreddit: "test",
              comments: 3,
              created_utc: 100,
            },
          ],
          after: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const client = new RedditApisClient({
      apiKey: "secret",
      baseUrl: "https://api.redditapis.com",
      configured: true,
    });
    const posts = await client.listNew("r/test", 10);

    assert.match(seenUrl, /\/api\/reddit\/posts\?/);
    assert.match(seenUrl, /subreddit=test/);
    assert.match(seenUrl, /sort=new/);
    assert.match(seenUrl, /limit=10/);
    assert.equal(seenAuth, "Bearer secret");
    assert.equal(posts.length, 1);
    assert.equal(posts[0]!.selftext, "body");
    assert.equal(posts[0]!.numComments, 3);
  });

  it("throws when key missing", () => {
    assert.throws(
      () =>
        new RedditApisClient({
          baseUrl: "https://api.redditapis.com",
          configured: false,
        }),
      /REDDITAPIS_API_KEY/
    );
  });
});
