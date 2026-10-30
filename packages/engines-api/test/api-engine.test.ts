import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseServiceDescriptorYaml } from "@relay/protocol";
import { ApiEngine, buildApiRequest, createApiEngine } from "../src/index.js";

function loadService(name: string) {
  const candidates = [
    join(__dirname, `../../../protocol/services/${name}`),
    join(__dirname, `../../protocol/services/${name}`),
  ];
  for (const p of candidates) {
    try {
      return parseServiceDescriptorYaml(readFileSync(p, "utf8"));
    } catch {
      /* try next */
    }
  }
  throw new Error(`missing ${name}`);
}

const redditPublic = loadService("reddit-public.yaml");
const redditOauth = loadService("reddit-oauth.yaml");

describe("buildApiRequest", () => {
  it("builds listNew GET with query params", () => {
    const built = buildApiRequest(redditPublic, {
      service: "reddit-public",
      operation: "listNew",
      params: { subreddit: "malefashionadvice", limit: 10 },
    });
    assert.ok(!("error" in built));
    if ("error" in built) return;
    assert.equal(built.method, "GET");
    assert.match(built.url, /\/api\/reddit\/posts\?/);
    assert.match(built.url, /subreddit=malefashionadvice/);
    assert.match(built.url, /limit=10/);
  });

  it("builds comment POST as form body", () => {
    const built = buildApiRequest(redditOauth, {
      service: "reddit-oauth",
      operation: "comment",
      params: { thing_id: "t3_abc", text: "hello", api_type: "json" },
    });
    assert.ok(!("error" in built));
    if ("error" in built) return;
    assert.equal(built.method, "POST");
    assert.equal(built.bodyEncoding, "form");
    assert.match(built.body ?? "", /thing_id=t3_abc/);
    assert.match(built.body ?? "", /text=hello/);
  });

  it("rejects unknown operations", () => {
    const built = buildApiRequest(redditPublic, {
      service: "reddit-public",
      operation: "invented",
    });
    assert.ok("error" in built);
  });

  it("keeps absolute http(s) path params unencoded (http-fetch / rss)", () => {
    const httpFetch = {
      id: "http-fetch",
      baseUrl: "https://relay.invalid",
      auth: { type: "none" as const },
      operations: [
        {
          id: "get",
          method: "GET" as const,
          path: "{url}",
          params: [
            { name: "url", in: "path" as const, required: true, type: "string" as const },
          ],
        },
      ],
    };
    const built = buildApiRequest(httpFetch, {
      service: "http-fetch",
      operation: "get",
      params: { url: "https://example.com/feed.xml?x=1" },
    });
    assert.ok(!("error" in built));
    if ("error" in built) return;
    assert.equal(built.url, "https://example.com/feed.xml?x=1");
  });
});

describe("ApiEngine", () => {
  it("replays fixtures for listNew without network", async () => {
    const posts = [{ id: "t3_1", title: "fit check" }];
    const engine = createApiEngine({
      services: [redditPublic, redditOauth],
      fixtures: [
        {
          service: "reddit-public",
          operation: "listNew",
          params: { subreddit: "malefashionadvice" },
          body: { posts },
        },
      ],
      fetch: async () => {
        throw new Error("network should not be called");
      },
    });

    const result = await engine.execute({
      type: "request",
      params: {
        service: "reddit-public",
        operation: "listNew",
        params: { subreddit: "malefashionadvice" },
      },
    });
    assert.equal(result.success, true);
    assert.equal(result.data.fixture, true);
    assert.deepEqual(result.data.body.posts, posts);
  });

  it("simulates irreversible comment under dryRun", async () => {
    let fetched = false;
    const engine = new ApiEngine({
      services: [redditPublic, redditOauth],
      dryRun: true,
      resolveConnection: async () => ({ type: "bearer", token: "secret" }),
      fetch: async () => {
        fetched = true;
        return new Response("nope", { status: 500 });
      },
    });

    const result = await engine.request({
      service: "reddit-oauth",
      operation: "comment",
      connection: "reddit:default",
      params: { thing_id: "t3_x", text: "hi" },
    });
    assert.equal(fetched, false);
    assert.equal(result.dryRunSimulated, true);
    assert.equal(
      (result.body as { dryRun?: boolean }).dryRun,
      true
    );
  });

  it("attaches bearer auth and fetches when dryRun is false", async () => {
    const engine = createApiEngine({
      services: [redditPublic],
      dryRun: false,
      resolveConnection: async (id) => {
        assert.equal(id, "redditapis:default");
        return { type: "bearer", token: "test-key" };
      },
      fetch: async (input, init) => {
        const url = String(input);
        assert.match(url, /\/api\/reddit\/posts/);
        const headers = init?.headers as Record<string, string>;
        assert.equal(headers.Authorization, "Bearer test-key");
        return new Response(JSON.stringify({ posts: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    const data = await engine.request({
      service: "reddit-public",
      operation: "listNew",
      connection: "redditapis:default",
      params: { subreddit: "fashion" },
      dryRun: false,
    });
    assert.equal(data.status, 200);
    assert.deepEqual(data.body, { posts: [] });
  });

  it("fails closed without connection when auth required", async () => {
    const engine = createApiEngine({
      services: [redditOauth],
      dryRun: false,
      fixtures: [],
    });
    const result = await engine.execute({
      type: "api.request",
      params: {
        service: "reddit-oauth",
        operation: "comment",
        params: { thing_id: "t3_x", text: "hi" },
      },
    });
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /connection/i);
  });
});
