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

  it("maps link_url to listing url and is_self=false", () => {
    const mapped = mapRedditApisPost({
      id: "img1",
      name: "t3_img1",
      title: "Office shirt help",
      author: "op",
      permalink: "/r/fashion/comments/img1/office/",
      url: "https://www.reddit.com/r/fashion/comments/img1/office/",
      link_url: "https://i.redd.it/abc123.jpg",
      text: "",
      subreddit: "fashion",
      comments: 0,
      created_utc: 1_700_000_000,
      is_self: false,
    });
    assert.ok(mapped);
    assert.equal(mapped!.url, "https://i.redd.it/abc123.jpg");
    assert.equal(mapped!.isSelf, false);
    assert.match(mapped!.permalink, /reddit\.com\/r\/fashion/);
  });

  it("falls back to crosspost_origin.link_url for media", () => {
    const mapped = mapRedditApisPost({
      id: "xp1",
      name: "t3_xp1",
      title: "Fit check",
      author: "op",
      permalink: "/r/fashion/comments/xp1/fit/",
      url: "https://www.reddit.com/r/fashion/comments/xp1/fit/",
      link_url: null,
      text: "",
      subreddit: "fashion",
      is_self: false,
      is_crosspost: true,
      crosspost_origin: {
        id: "orig",
        link_url: "https://i.redd.it/orig.jpg",
      },
      created_utc: 1_700_000_000,
    });
    assert.ok(mapped);
    assert.equal(mapped!.url, "https://i.redd.it/orig.jpg");
    assert.equal(mapped!.isSelf, false);
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

  it("getComment strips t1_ and returns comment node", async () => {
    let seenUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seenUrl = String(input);
      return new Response(
        JSON.stringify({
          comment: {
            kind: "t1",
            data: {
              id: "phxxrt8",
              body: "hello",
              author: "u1",
              permalink: "/r/test/comments/abc/title/phxxrt8/",
              replies: "",
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const client = new RedditApisClient({
      apiKey: "secret",
      baseUrl: "https://api.redditapis.com",
      configured: true,
    });
    const result = await client.getComment("t1_phxxrt8");
    assert.equal(seenUrl, "https://api.redditapis.com/api/reddit/comment/phxxrt8");
    assert.equal(result.status, 200);
    assert.equal(result.comment?.data?.id, "phxxrt8");
    assert.equal(result.comment?.data?.body, "hello");
  });

  it("getComment maps 404", async () => {
    globalThis.fetch = (async () =>
      new Response("gone", { status: 404 })) as typeof fetch;
    const client = new RedditApisClient({
      apiKey: "secret",
      baseUrl: "https://api.redditapis.com",
      configured: true,
    });
    const result = await client.getComment("deadbeef");
    assert.equal(result.status, 404);
    assert.ok(result.error);
  });
});
