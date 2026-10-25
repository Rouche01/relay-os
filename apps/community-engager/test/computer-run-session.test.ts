import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ComputerEngine } from "@relay/engines-computer";
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

function leaseJson(sessionId = "sess-run") {
  return {
    session_id: sessionId,
    api_base: `http://gw/v1/sessions/${sessionId}`,
    vnc_url: "http://localhost:6081/vnc.html",
    expires_at: "2099-01-01T00:00:00Z",
  };
}

describe("ComputerRunSession", () => {
  it("engageJobId prefixes the agent session id", () => {
    assert.equal(engageJobId("abc-123"), "engage:abc-123");
  });

  it("leases, parks, reacquires same session, then recycles", async () => {
    let state: "free" | "leased" | "parked" = "free";
    let lastLeaseBody: unknown;
    const fetchImpl = mockFetch({
      "POST /v1/sessions": ({ body }) => {
        lastLeaseBody = body;
        if (state === "parked") {
          // Gateway job_id reattach path (not used when acquire succeeds first)
          state = "leased";
          return { status: 200, json: leaseJson() };
        }
        state = "leased";
        return { status: 200, json: leaseJson() };
      },
      "DELETE /v1/sessions/sess-run": ({ search }) => {
        if (search.includes("recycle=true")) {
          state = "free";
          return {
            status: 200,
            json: { ok: true, session_id: "sess-run", recycled: true },
          };
        }
        state = "parked";
        return {
          status: 200,
          json: { ok: true, session_id: "sess-run", parked: true },
        };
      },
      "POST /v1/sessions/sess-run/acquire": () => {
        assert.equal(state, "parked");
        state = "leased";
        return { status: 200, json: leaseJson() };
      },
    });

    const engine = new ComputerEngine({
      baseUrl: "http://gw",
      agentId: "community-engager",
      fetch: fetchImpl,
    });
    const run = new ComputerRunSession({
      engine,
      jobId: engageJobId("run-1"),
      agentId: "community-engager",
    });

    const first = await run.ensureLeased();
    assert.equal(first.ok, true);
    assert.equal(first.sessionId, "sess-run");
    assert.equal(first.vncUrl, "http://localhost:6081/vnc.html");
    assert.equal(run.isLeased, true);
    assert.deepEqual(lastLeaseBody, {
      agent_id: "community-engager",
      job_id: "engage:run-1",
      ttl_sec: 600,
    });

    const parked = await run.park();
    assert.equal(parked.ok, true);
    assert.equal(run.isLeased, false);
    assert.equal(run.sessionId, "sess-run");
    assert.equal(run.vncUrl, "http://localhost:6081/vnc.html");
    assert.equal(state, "parked");

    const second = await run.ensureLeased();
    assert.equal(second.ok, true);
    assert.equal(second.reattached, true);
    assert.equal(second.sessionId, "sess-run");
    assert.equal(run.isLeased, true);

    const recycled = await run.recycle();
    assert.equal(recycled.ok, true);
    assert.equal(run.isRecycled, true);
    assert.equal(state, "free");
    assert.equal(run.sessionId, undefined);

    const after = await run.ensureLeased();
    assert.equal(after.ok, false);
    assert.match(after.error ?? "", /recycled/);
  });

  it("ensureLeased is a no-op when already leased", async () => {
    let leaseCount = 0;
    const fetchImpl = mockFetch({
      "POST /v1/sessions": () => {
        leaseCount += 1;
        return { status: 200, json: leaseJson() };
      },
    });
    const engine = new ComputerEngine({ baseUrl: "http://gw", fetch: fetchImpl });
    const run = new ComputerRunSession({
      engine,
      jobId: "engage:x",
    });
    assert.equal((await run.ensureLeased()).ok, true);
    assert.equal((await run.ensureLeased()).ok, true);
    assert.equal(leaseCount, 1);
  });
});
