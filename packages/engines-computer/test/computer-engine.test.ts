import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ComputerEngine } from "../src/computer-engine.js";

type RouteHandler = (req: {
  method: string;
  path: string;
  body: unknown;
  headers: Headers;
}) => { status: number; json?: unknown };

function mockGateway(handlers: Record<string, RouteHandler>): typeof fetch {
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
    let body: unknown;
    if (init?.body) {
      body = JSON.parse(String(init.body));
    }
    const result = handler({
      method,
      path: url.pathname,
      body,
      headers: new Headers(init?.headers),
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

describe("ComputerEngine", () => {
  it("leases, screenshots, acts, and releases against the gateway", async () => {
    let leased = false;
    const fetchImpl = mockGateway({
      "GET /ready": () => ({ status: 200, json: { ok: true, free: 1 } }),
      "POST /v1/sessions": ({ body, headers }) => {
        assert.equal(headers.get("Authorization"), "Bearer secret");
        assert.equal(headers.get("X-Job-Id"), "job-1");
        assert.deepEqual(body, {
          agent_id: "ce",
          job_id: "job-1",
          ttl_sec: 120,
        });
        leased = true;
        return {
          status: 200,
          json: {
            session_id: "sess-1",
            api_base: "http://gw/v1/sessions/sess-1",
            vnc_url: "http://localhost:6081/vnc.html",
            expires_at: "2099-01-01T00:00:00Z",
          },
        };
      },
      "GET /v1/sessions/sess-1/screenshot": () => {
        assert.equal(leased, true);
        return { status: 200, json: { image: "base64png" } };
      },
      "POST /v1/sessions/sess-1/action": ({ body }) => {
        assert.deepEqual(body, { type: "key", text: "ctrl+l" });
        return { status: 200, json: { ok: true } };
      },
      "DELETE /v1/sessions/sess-1": () => {
        leased = false;
        return { status: 200, json: { ok: true } };
      },
    });

    const engine = new ComputerEngine({
      baseUrl: "http://gw",
      token: "secret",
      agentId: "ce",
      fetch: fetchImpl,
    });

    assert.equal(await engine.healthCheck(), true);

    const lease = await engine.execute({
      type: "lease",
      params: { job_id: "job-1", ttl_sec: 120 },
    });
    assert.equal(lease.success, true);
    assert.equal(engine.getSessionId(), "sess-1");
    assert.equal(engine.getVncUrl(), "http://localhost:6081/vnc.html");

    const shot = await engine.execute({ type: "screenshot", params: {} });
    assert.equal(shot.success, true);
    assert.equal(shot.data?.image, "base64png");

    const act = await engine.execute({
      type: "action",
      params: { action: { type: "key", text: "ctrl+l" } },
    });
    assert.equal(act.success, true);

    const rel = await engine.execute({ type: "release", params: {} });
    assert.equal(rel.success, true);
    assert.equal(engine.getSessionId(), null);
    assert.equal(leased, false);
  });

  it("teardown releases an open session", async () => {
    let deleted = false;
    const fetchImpl = mockGateway({
      "POST /v1/sessions": () => ({
        status: 200,
        json: {
          session_id: "s2",
          api_base: "http://gw/v1/sessions/s2",
          vnc_url: "http://vnc",
          expires_at: "2099-01-01T00:00:00Z",
        },
      }),
      "DELETE /v1/sessions/s2": () => {
        deleted = true;
        return { status: 200, json: { ok: true } };
      },
    });

    const engine = new ComputerEngine({
      baseUrl: "http://gw/",
      fetch: fetchImpl,
    });
    await engine.execute({ type: "lease", params: {} });
    await engine.teardown();
    assert.equal(deleted, true);
    assert.equal(engine.getSessionId(), null);
  });

  it("returns failure when pool is full", async () => {
    const engine = new ComputerEngine({
      baseUrl: "http://gw",
      fetch: mockGateway({
        "POST /v1/sessions": () => ({
          status: 503,
          json: { detail: { error: "no free workers" } },
        }),
      }),
    });
    const result = await engine.execute({ type: "lease", params: {} });
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /503/);
  });

  it("refuses screenshot without a lease", async () => {
    const engine = new ComputerEngine({
      baseUrl: "http://gw",
      fetch: mockGateway({}),
    });
    const result = await engine.execute({ type: "screenshot", params: {} });
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /no leased session/);
  });
});
