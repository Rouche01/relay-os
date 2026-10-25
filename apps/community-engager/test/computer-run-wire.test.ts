/**
 * Preview parks → execute reattaches same session_id / VNC → recycle.
 * Dogfood note: with a live gateway, the VNC URL printed at preview should
 * still show the same desktop after Approve (same engage: job_id).
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { ComputerEngine } from "@relay/engines-computer";
import { resetAppConfigCache } from "../src/app-config.js";
import { getCommunityConfig } from "../src/reddit/config.js";
import { runComputerDryRunEvidence } from "../src/reddit/write/computer-dry-run.js";
import { runComputerDesktopPreview } from "../src/reddit/write/computer-preview.js";
import {
  ComputerRunSession,
  engageJobId,
} from "../src/reddit/write/computer-run-session.js";
import type { CommunityDraft } from "../src/types.js";

type RouteHandler = (req: {
  method: string;
  path: string;
  search: string;
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
    const result = handler({
      method,
      path: url.pathname,
      search: url.search,
      body,
    });
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

const VNC = "http://localhost:6081/vnc.html?session=sess-wire";

function leaseJson(sessionId = "sess-wire") {
  return {
    session_id: sessionId,
    api_base: `http://gw/v1/sessions/${sessionId}`,
    vnc_url: VNC,
    expires_at: "2099-01-01T00:00:00Z",
  };
}

function draft(id: string, url: string): CommunityDraft {
  return {
    id,
    platform: "reddit",
    subreddit: "test",
    threadUrl: url,
    threadTitle: "t",
    draftText: "helpful reply",
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

describe("computer run wire (preview → execute → recycle)", () => {
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

  it("reuses one session_id and VNC across preview park and dry-run reattach", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "ce-wire-"));
    tmpDirs.push(dataDir);

    let state: "free" | "leased" | "parked" = "free";
    let leaseCount = 0;
    let acquireCount = 0;
    let softParkCount = 0;
    let recycleCount = 0;
    const typed: string[] = [];

    const fetchImpl = mockFetch({
      "POST /v1/sessions": ({ body }) => {
        leaseCount += 1;
        const b = body as { job_id?: string };
        assert.equal(b.job_id, "engage:wire-1");
        state = "leased";
        return { status: 200, json: leaseJson() };
      },
      "POST /v1/sessions/sess-wire/action": ({ body }) => {
        const b = body as { type: string; text?: string };
        if (b.type === "type" && b.text) typed.push(b.text);
        return { status: 200, json: { ok: true } };
      },
      "GET /v1/sessions/sess-wire/screenshot": () => ({
        status: 200,
        json: { image: TINY_PNG_B64 },
      }),
      "DELETE /v1/sessions/sess-wire": ({ search }) => {
        if (search.includes("recycle=true")) {
          recycleCount += 1;
          state = "free";
          return {
            status: 200,
            json: { ok: true, session_id: "sess-wire", recycled: true },
          };
        }
        softParkCount += 1;
        state = "parked";
        return {
          status: 200,
          json: {
            ok: true,
            session_id: "sess-wire",
            parked: true,
            vnc_url: VNC,
          },
        };
      },
      "POST /v1/sessions/sess-wire/acquire": () => {
        assert.equal(state, "parked");
        acquireCount += 1;
        state = "leased";
        return { status: 200, json: leaseJson() };
      },
    });

    setEnv("REDDIT_TRANSPORT", "computer");
    setEnv("COMPUTER_PREVIEW", "true");
    setEnv("REDDIT_DATA_DIR", dataDir);
    setEnv("COMPUTER_SETTLE_MS", "0");
    setEnv("COMPUTER_PREVIEW_MAX", "1");
    resetAppConfigCache();

    const engine = new ComputerEngine({
      baseUrl: "http://gw",
      agentId: "community-engager",
      fetch: fetchImpl,
    });
    const runSession = new ComputerRunSession({
      engine,
      jobId: engageJobId("wire-1"),
      agentId: "community-engager",
    });

    const cfg = getCommunityConfig(process.env);
    const preview = await runComputerDesktopPreview({
      opportunities: [
        draft("1", "https://www.reddit.com/r/t/comments/aaa/"),
      ],
      cfg,
      runSession,
    });

    assert.equal(preview.success, true);
    assert.equal(preview.vncUrl, VNC);
    assert.equal(runSession.sessionId, "sess-wire");
    assert.equal(runSession.vncUrl, VNC);
    assert.equal(runSession.isLeased, false);
    assert.equal(state, "parked");
    assert.equal(leaseCount, 1);
    assert.ok(softParkCount >= 1);

    const dry = await runComputerDryRunEvidence({
      draft: draft("1", "https://www.reddit.com/r/t/comments/aaa/"),
      text: "not typed",
      jobId: "post:reddit-1",
      dataDir,
      engine,
      runSession,
      settleMs: 0,
    });

    assert.equal(dry.ok, true);
    assert.equal(dry.transport, "computer");
    assert.equal(acquireCount, 1);
    assert.equal(leaseCount, 1); // no second fresh lease
    assert.equal(runSession.sessionId, "sess-wire");
    assert.equal(runSession.vncUrl, VNC);
    assert.equal(runSession.isLeased, false);
    assert.equal(state, "parked");
    assert.ok(typed.includes("https://www.reddit.com/r/t/comments/aaa/"));

    const recycled = await runSession.recycle();
    assert.equal(recycled.ok, true);
    assert.equal(recycleCount, 1);
    assert.equal(state, "free");
    assert.equal(runSession.isRecycled, true);
  });
});
