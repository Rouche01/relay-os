import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { ComputerEngine } from "@relay/engines-computer";
import { resetAppConfigCache } from "../src/app-config.js";
import { getCommunityConfig } from "../src/reddit/config.js";
import { runComputerDesktopPreview } from "../src/reddit/write/computer-preview.js";
import type { CommunityDraft } from "../src/types.js";

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

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function draft(id: string, url: string): CommunityDraft {
  return {
    id,
    platform: "reddit",
    subreddit: "test",
    threadUrl: url,
    threadTitle: "t",
    draftText: "d",
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
    status: "proposed",
    createdAt: new Date().toISOString(),
  };
}

describe("computer desktop preview", () => {
  const prev: Record<string, string | undefined> = {};
  const tmpDirs: string[] = [];

  afterEach(async () => {
    resetAppConfigCache();
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
    while (tmpDirs.length) {
      await rm(tmpDirs.pop()!, { recursive: true, force: true });
    }
  });

  function setEnv(key: string, value: string) {
    prev[key] = process.env[key];
    process.env[key] = value;
  }

  it("defaults COMPUTER_PREVIEW on when REDDIT_TRANSPORT=computer", () => {
    setEnv("REDDIT_TRANSPORT", "computer");
    resetAppConfigCache();
    const cfg = getCommunityConfig(process.env);
    assert.equal(cfg.computer.preview, true);
  });

  it("COMPUTER_PREVIEW=false overrides transport default", () => {
    setEnv("REDDIT_TRANSPORT", "computer");
    setEnv("COMPUTER_PREVIEW", "false");
    resetAppConfigCache();
    assert.equal(getCommunityConfig(process.env).computer.preview, false);
  });

  it("skips when preview disabled", async () => {
    setEnv("REDDIT_TRANSPORT", "browser");
    setEnv("COMPUTER_PREVIEW", "false");
    resetAppConfigCache();
    const cfg = getCommunityConfig(process.env);
    const result = await runComputerDesktopPreview({
      opportunities: [draft("a", "https://reddit.com/r/t/comments/1/")],
      cfg,
    });
    assert.equal(result.skipped, true);
    assert.match(result.reason ?? "", /off/i);
  });

  it("tours URLs and writes preview evidence", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "ce-preview-"));
    tmpDirs.push(dataDir);
    setEnv("REDDIT_TRANSPORT", "computer");
    setEnv("COMPUTER_PREVIEW", "true");
    setEnv("REDDIT_DATA_DIR", dataDir);
    setEnv("COMPUTER_SETTLE_MS", "0");
    setEnv("COMPUTER_PREVIEW_MAX", "2");
    resetAppConfigCache();

    let leased = false;
    const typed: string[] = [];
    const engine = new ComputerEngine({
      baseUrl: "http://gw",
      fetch: mockFetch({
        "POST /v1/sessions": () => {
          leased = true;
          return {
            status: 200,
            json: {
              session_id: "sess-p",
              api_base: "http://gw/v1/sessions/sess-p",
              vnc_url: "http://vnc",
              expires_at: "2099-01-01T00:00:00Z",
            },
          };
        },
        "POST /v1/sessions/sess-p/action": ({ body }) => {
          const b = body as { type: string; text?: string };
          if (b.type === "type" && b.text) typed.push(b.text);
          return { status: 200, json: { ok: true } };
        },
        "GET /v1/sessions/sess-p/screenshot": () => ({
          status: 200,
          json: { image: TINY_PNG_B64 },
        }),
        "DELETE /v1/sessions/sess-p": () => {
          leased = false;
          return { status: 200, json: { ok: true } };
        },
      }),
    });

    const cfg = getCommunityConfig(process.env);
    const result = await runComputerDesktopPreview({
      opportunities: [
        draft("1", "https://www.reddit.com/r/t/comments/aaa/"),
        draft("2", "https://www.reddit.com/r/t/comments/bbb/"),
        draft("3", "https://www.reddit.com/r/t/comments/ccc/"),
      ],
      cfg,
      engine,
    });

    assert.equal(result.success, true);
    assert.equal(result.urls?.length, 2);
    assert.deepEqual(typed, [
      "https://www.reddit.com/r/t/comments/aaa/",
      "https://www.reddit.com/r/t/comments/bbb/",
    ]);
    assert.equal(leased, false);
    const previewDir = path.join(dataDir, "evidence", "computer", "preview");
    const files = await readdir(previewDir);
    assert.ok(files.some((f) => f.endsWith(".png")));
  });
});
