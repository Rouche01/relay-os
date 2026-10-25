import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { ComputerEngine } from "@relay/engines-computer";
import { resetAppConfigCache } from "../src/app-config.js";
import {
  getCommunityConfig,
  resolveWriteTransport,
  resolveWriteTransportChain,
} from "../src/reddit/config.js";
import { executeApproved } from "../src/stages/execute/executor.js";
import type { CommunityDraft } from "../src/types.js";

function sampleDraft(): CommunityDraft {
  return {
    id: "reddit-computer-dry-run",
    platform: "reddit",
    subreddit: "test",
    threadUrl: "https://www.reddit.com/r/test/comments/abc/title/",
    threadTitle: "test thread",
    draftText: "helpful reply without plugs",
    intensity: 0,
    score: {
      problemFit: true,
      wantsHelp: true,
      rulesOk: true,
      freshnessOk: true,
      valueWithoutApp: true,
      competition: true,
      icpFit: false,
      plugNaturalness: false,
    },
    rationale: "test",
    status: "approved",
    createdAt: new Date().toISOString(),
  };
}

type RouteHandler = (req: {
  method: string;
  path: string;
  body: unknown;
}) => { status: number; json?: unknown };

function mockFetch(handlers: Record<string, RouteHandler>): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${url.pathname}`;
    const handler = handlers[key];
    if (!handler) {
      return new Response(JSON.stringify({ detail: `no route ${key}` }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const result = handler({ method, path: url.pathname, body });
    return new Response(
      result.json !== undefined ? JSON.stringify(result.json) : null,
      {
        status: result.status,
        headers: { "Content-Type": "application/json" },
      }
    );
  };
}

describe("REDDIT_TRANSPORT=computer", () => {
  const prev: Record<string, string | undefined> = {};

  afterEach(async () => {
    resetAppConfigCache();
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  function setEnv(key: string, value: string) {
    prev[key] = process.env[key];
    process.env[key] = value;
  }

  it("resolves write transport to computer (no browser/oauth chain)", () => {
    setEnv("REDDIT_TRANSPORT", "computer");
    const cfg = getCommunityConfig(process.env);
    assert.equal(cfg.reddit.transport, "computer");
    assert.equal(resolveWriteTransport(cfg), "computer");
    assert.deepEqual(resolveWriteTransportChain(cfg), []);
  });

  it("executeApproved leases, navigates, stores evidence, releases — never posts", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "ce-computer-"));
    const actions: string[] = [];
    let released = false;

    const fetchImpl = mockFetch({
      "POST /v1/sessions": () => ({
        status: 200,
        json: {
          session_id: "sess-ce",
          api_base: "http://gw/v1/sessions/sess-ce",
          vnc_url: "http://localhost:6081/vnc.html",
          expires_at: "2099-01-01T00:00:00Z",
        },
      }),
      "POST /v1/sessions/sess-ce/action": ({ body }) => {
        const b = body as { type: string; text?: string };
        actions.push(
          b.type === "type" ? `type:${b.text}` : `${b.type}:${b.text ?? ""}`
        );
        return { status: 200, json: { ok: true } };
      },
      "GET /v1/sessions/sess-ce/screenshot": () => ({
        // 1x1 PNG
        status: 200,
        json: {
          image:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        },
      }),
      "DELETE /v1/sessions/sess-ce": () => {
        released = true;
        return { status: 200, json: { ok: true } };
      },
    });

    setEnv("REDDIT_TRANSPORT", "computer");
    setEnv("COMMUNITY_POST_MODE", "auto");
    setEnv("REDDIT_DRY_RUN", "false"); // still must not post
    setEnv("REDDIT_DATA_DIR", dataDir);

    const engine = new ComputerEngine({
      baseUrl: "http://gw",
      fetch: fetchImpl,
    });

    try {
      const result = await executeApproved(sampleDraft(), {
        computerEngine: engine,
        computerSettleMs: 0,
        dataDir,
      });

      assert.equal(result.ok, true);
      assert.equal(result.dryRun, true);
      assert.equal(result.transport, "computer");
      assert.equal(result.postedUrl, undefined);
      assert.equal(released, true);
      assert.ok(actions.some((a) => a.startsWith("key:ctrl+l")));
      assert.ok(
        actions.some((a) =>
          a.includes("https://www.reddit.com/r/test/comments/abc/title/")
        )
      );
      assert.ok(actions.some((a) => a.startsWith("key:Return")));

      const safeId = result.jobId.replace(/:/g, "_");
      const metaRaw = await readFile(
        path.join(dataDir, "evidence", "computer", `${safeId}.json`),
        "utf8"
      );
      const meta = JSON.parse(metaRaw) as { vncUrl?: string; note?: string };
      assert.equal(meta.vncUrl, "http://localhost:6081/vnc.html");
      assert.match(String(meta.note), /NOT posted/i);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
