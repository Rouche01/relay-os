/**
 * Computer challenge gate: classify wall → park → human/poll clear → same session.
 * Dogfood: Approve (or forceRecheck feed) while watching the same VNC URL.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { ComputerEngine } from "@relay/engines-computer";
import {
  clearComputerChallengeSession,
  getComputerChallengeSession,
} from "../src/reddit/write/computer-challenge-session.js";
import {
  prepareComputerChallenge,
  runComputerChallengeGate,
} from "../src/reddit/write/computer-challenge.js";
import { classifyComputerFrame } from "../src/reddit/write/computer-frame-classify.js";
import {
  ComputerRunSession,
  engageJobId,
} from "../src/reddit/write/computer-run-session.js";

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

const VNC = "http://localhost:6081/vnc.html?session=sess-chal";

function leaseJson(sessionId = "sess-chal") {
  return {
    session_id: sessionId,
    api_base: `http://gw/v1/sessions/${sessionId}`,
    vnc_url: VNC,
    expires_at: "2099-01-01T00:00:00Z",
  };
}

function buildEngine() {
  let state: "free" | "leased" | "parked" = "free";
  const fetchImpl = mockFetch({
    "POST /v1/sessions": () => {
      state = "leased";
      return { status: 200, json: leaseJson() };
    },
    "POST /v1/sessions/sess-chal/action": () => ({
      status: 200,
      json: { ok: true },
    }),
    "GET /v1/sessions/sess-chal/screenshot": () => ({
      status: 200,
      json: { image: TINY_PNG_B64 },
    }),
    "DELETE /v1/sessions/sess-chal": ({ search }) => {
      if (search.includes("recycle=true")) {
        state = "free";
        return {
          status: 200,
          json: { ok: true, session_id: "sess-chal", recycled: true },
        };
      }
      state = "parked";
      return {
        status: 200,
        json: { ok: true, session_id: "sess-chal", parked: true, vnc_url: VNC },
      };
    },
    "POST /v1/sessions/sess-chal/acquire": () => {
      assert.equal(state, "parked");
      state = "leased";
      return { status: 200, json: leaseJson() };
    },
  });
  return {
    engine: new ComputerEngine({
      baseUrl: "http://gw",
      agentId: "community-engager",
      fetch: fetchImpl,
    }),
    getState: () => state,
  };
}

describe("classifyComputerFrame", () => {
  it("assume_wall seeds login / interstitial via forcePageClass", async () => {
    const login = await classifyComputerFrame({
      evidencePath: "/tmp/x.png",
      reason: "login",
      forcePageClass: "login",
    });
    assert.equal(login.pageClass, "login");
    assert.equal(login.detection.challenged, true);

    const wall = await classifyComputerFrame({
      evidencePath: "/tmp/x.png",
      reason: "interstitial",
      forcePageClass: "interstitial",
    });
    assert.equal(wall.pageClass, "interstitial");
  });

  it("heuristic recheck never auto-clears without force", async () => {
    process.env.DECIDE_BACKEND = "heuristic";
    const recheck = await classifyComputerFrame({
      evidencePath: "/tmp/x.png",
      reason: "interstitial",
      phase: "recheck",
    });
    assert.equal(recheck.pageClass, "unknown");
    assert.equal(recheck.escalateHitl, true);
  });
});

describe("computer challenge gate", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    clearComputerChallengeSession();
    while (tmpDirs.length) {
      await rm(tmpDirs.pop()!, { recursive: true, force: true });
    }
  });

  it("prepare parks on wall and registers session with vnc meta", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "ce-chal-"));
    tmpDirs.push(dataDir);
    const evidenceDir = path.join(dataDir, "evidence", "computer", "challenge");
    const { engine, getState } = buildEngine();
    const runSession = new ComputerRunSession({
      engine,
      jobId: engageJobId("chal-1"),
      agentId: "community-engager",
    });

    const prepared = await prepareComputerChallenge({
      runSession,
      evidenceDir,
      reason: "interstitial",
      url: "https://www.reddit.com/",
      settleMs: 0,
      forcePageClass: "interstitial",
    });

    assert.equal(prepared.status, "wall");
    if (prepared.status !== "wall") return;
    assert.equal(prepared.hitl.meta.transport, "computer");
    assert.equal(prepared.hitl.meta.kind, "interstitial");
    assert.equal(prepared.hitl.meta.vncUrl, VNC);
    assert.equal(prepared.hitl.meta.engageJobId, "engage:chal-1");
    assert.equal(getState(), "parked");
    assert.ok(getComputerChallengeSession());
    assert.equal(runSession.sessionId, "sess-chal");
  });

  it("gate clears via human Approve and reattaches same session", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "ce-chal-"));
    tmpDirs.push(dataDir);
    const evidenceDir = path.join(dataDir, "evidence", "computer", "challenge");
    const { engine, getState } = buildEngine();
    const runSession = new ComputerRunSession({
      engine,
      jobId: engageJobId("chal-2"),
    });

    const result = await runComputerChallengeGate({
      runSession,
      evidenceDir,
      reason: "login",
      url: "https://www.reddit.com/login/",
      settleMs: 0,
      forcePageClass: "login",
      pollMs: 500,
      maxWaitMs: 10_000,
      waitForHuman: async (ctx) => {
        assert.equal(ctx.meta.vncUrl, VNC);
        assert.equal(getState(), "parked");
        return "proceed";
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.clearedBy, "human");
    assert.equal(result.vncUrl, VNC);
    assert.equal(runSession.isLeased, true);
    assert.equal(runSession.sessionId, "sess-chal");
    assert.equal(getComputerChallengeSession(), undefined);
  });

  it("gate clears via poll when forceRecheck returns feed", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "ce-chal-"));
    tmpDirs.push(dataDir);
    const evidenceDir = path.join(dataDir, "evidence", "computer", "challenge");
    const { engine } = buildEngine();
    const runSession = new ComputerRunSession({
      engine,
      jobId: engageJobId("chal-3"),
    });

    let polls = 0;
    const result = await runComputerChallengeGate({
      runSession,
      evidenceDir,
      reason: "interstitial",
      settleMs: 0,
      forcePageClass: "interstitial",
      pollMs: 50,
      maxWaitMs: 5_000,
      forceRecheckPageClass: () => {
        polls += 1;
        return polls >= 1 ? "feed" : "interstitial";
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.clearedBy, "poll");
    assert.ok(polls >= 1);
  });

  it("rate_limit does not register HITL session", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "ce-chal-"));
    tmpDirs.push(dataDir);
    const evidenceDir = path.join(dataDir, "evidence", "computer", "challenge");
    const { engine } = buildEngine();
    const runSession = new ComputerRunSession({
      engine,
      jobId: engageJobId("chal-4"),
    });

    const prepared = await prepareComputerChallenge({
      runSession,
      evidenceDir,
      reason: "interstitial",
      settleMs: 0,
      forcePageClass: "rate_limit",
    });

    assert.equal(prepared.status, "rate_limit");
    assert.equal(getComputerChallengeSession(), undefined);
  });
});
