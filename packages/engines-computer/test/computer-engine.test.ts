import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ComputerEngine } from "../src/computer-engine.js";

type RouteHandler = (req: {
  method: string;
  path: string;
  search: string;
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
      search: url.search,
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

function leaseJson(sessionId = "sess-1") {
  return {
    session_id: sessionId,
    api_base: `http://gw/v1/sessions/${sessionId}`,
    vnc_url: "http://localhost:6081/vnc.html",
    expires_at: "2099-01-01T00:00:00Z",
  };
}

describe("ComputerEngine", () => {
  it("leases, screenshots, acts, and soft-parks on release", async () => {
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
        return { status: 200, json: leaseJson() };
      },
      "GET /v1/sessions/sess-1/screenshot": () => {
        assert.equal(leased, true);
        return { status: 200, json: { image: "base64png" } };
      },
      "POST /v1/sessions/sess-1/action": ({ body }) => {
        assert.deepEqual(body, { type: "key", text: "ctrl+l" });
        return { status: 200, json: { ok: true } };
      },
      "DELETE /v1/sessions/sess-1": ({ search }) => {
        assert.equal(search, "");
        leased = false;
        return {
          status: 200,
          json: { ok: true, session_id: "sess-1", parked: true },
        };
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
    assert.equal(rel.data?.parked, true);
    assert.equal(engine.getSessionId(), null);
    assert.equal(engine.getParkedSessionId(), "sess-1");
    assert.equal(engine.getVncUrl(), "http://localhost:6081/vnc.html");
    assert.equal(leased, false);
  });

  it("acquires a soft-parked session", async () => {
    let state: "free" | "leased" | "parked" = "free";
    const fetchImpl = mockGateway({
      "POST /v1/sessions": () => {
        state = "leased";
        return { status: 200, json: leaseJson() };
      },
      "DELETE /v1/sessions/sess-1": ({ search }) => {
        if (search.includes("recycle=true")) {
          state = "free";
          return { status: 200, json: { ok: true, recycled: true } };
        }
        state = "parked";
        return {
          status: 200,
          json: { ok: true, session_id: "sess-1", parked: true },
        };
      },
      "POST /v1/sessions/sess-1/acquire": ({ body }) => {
        assert.equal(state, "parked");
        assert.equal((body as { ttl_sec?: number }).ttl_sec, 90);
        state = "leased";
        return { status: 200, json: leaseJson() };
      },
    });

    const engine = new ComputerEngine({
      baseUrl: "http://gw",
      agentId: "ce",
      fetch: fetchImpl,
    });

    await engine.execute({ type: "lease", params: { job_id: "engage-1" } });
    await engine.execute({ type: "release", params: {} });
    assert.equal(engine.getParkedSessionId(), "sess-1");

    const acq = await engine.execute({
      type: "acquire",
      params: { ttl_sec: 90 },
    });
    assert.equal(acq.success, true);
    assert.equal(engine.getSessionId(), "sess-1");
    assert.equal(engine.getParkedSessionId(), null);
    assert.equal(state, "leased");
  });

  it("recycles with recycle=true query and clears parked state", async () => {
    let recycled = false;
    const fetchImpl = mockGateway({
      "POST /v1/sessions": () => ({ status: 200, json: leaseJson() }),
      "DELETE /v1/sessions/sess-1": ({ search }) => {
        assert.match(search, /recycle=true/);
        recycled = true;
        return {
          status: 200,
          json: { ok: true, session_id: "sess-1", recycled: true },
        };
      },
    });

    const engine = new ComputerEngine({ baseUrl: "http://gw", fetch: fetchImpl });
    await engine.execute({ type: "lease", params: {} });
    const result = await engine.execute({ type: "recycle", params: {} });
    assert.equal(result.success, true);
    assert.equal(result.data?.recycled, true);
    assert.equal(recycled, true);
    assert.equal(engine.getSessionId(), null);
    assert.equal(engine.getParkedSessionId(), null);
    assert.equal(engine.getVncUrl(), null);
  });

  it("recycles a parked session without an active lease", async () => {
    let sawRecycle = false;
    const fetchImpl = mockGateway({
      "POST /v1/sessions": () => ({ status: 200, json: leaseJson() }),
      "DELETE /v1/sessions/sess-1": ({ search }) => {
        if (search.includes("recycle=true")) {
          sawRecycle = true;
          return { status: 200, json: { ok: true, recycled: true } };
        }
        return {
          status: 200,
          json: { ok: true, session_id: "sess-1", parked: true },
        };
      },
    });

    const engine = new ComputerEngine({ baseUrl: "http://gw", fetch: fetchImpl });
    await engine.execute({ type: "lease", params: {} });
    await engine.execute({ type: "release", params: {} });
    const result = await engine.execute({ type: "recycle", params: {} });
    assert.equal(result.success, true);
    assert.equal(sawRecycle, true);
    assert.equal(engine.getParkedSessionId(), null);
  });

  it("teardown soft-parks an open session", async () => {
    let parked = false;
    const fetchImpl = mockGateway({
      "POST /v1/sessions": () => ({
        status: 200,
        json: leaseJson("s2"),
      }),
      "DELETE /v1/sessions/s2": ({ search }) => {
        assert.equal(search, "");
        parked = true;
        return {
          status: 200,
          json: { ok: true, session_id: "s2", parked: true },
        };
      },
    });

    const engine = new ComputerEngine({
      baseUrl: "http://gw/",
      fetch: fetchImpl,
    });
    await engine.execute({ type: "lease", params: {} });
    await engine.teardown();
    assert.equal(parked, true);
    assert.equal(engine.getSessionId(), null);
    assert.equal(engine.getParkedSessionId(), "s2");
  });

  it("leases a phone seat with kind and surfaces seat_id / vnc_url", async () => {
    const fetchImpl = mockGateway({
      "POST /v1/sessions": ({ body }) => {
        assert.deepEqual(body, {
          agent_id: "ce",
          job_id: "phone-job",
          ttl_sec: 600,
          kind: "phone",
        });
        return {
          status: 200,
          json: {
            ...leaseJson("phone-sess"),
            kind: "phone",
            seat_id: "phone-1",
            vnc_url: "http://localhost:8000/vnc.html?path=ws",
          },
        };
      },
    });

    const engine = new ComputerEngine({
      baseUrl: "http://gw",
      agentId: "ce",
      fetch: fetchImpl,
    });

    const lease = await engine.execute({
      type: "lease",
      params: { job_id: "phone-job", kind: "phone" },
    });
    assert.equal(lease.success, true);
    assert.equal(lease.data?.kind, "phone");
    assert.equal(lease.data?.seat_id, "phone-1");
    assert.equal(engine.getKind(), "phone");
    assert.equal(engine.getSeatId(), "phone-1");
    assert.equal(
      engine.getVncUrl(),
      "http://localhost:8000/vnc.html?path=ws"
    );
  });

  it("omits kind on lease by default and treats the seat as desktop", async () => {
    const fetchImpl = mockGateway({
      "POST /v1/sessions": ({ body }) => {
        assert.equal(
          Object.prototype.hasOwnProperty.call(body as object, "kind"),
          false
        );
        return { status: 200, json: leaseJson() };
      },
    });

    const engine = new ComputerEngine({
      baseUrl: "http://gw",
      fetch: fetchImpl,
    });
    const lease = await engine.execute({ type: "lease", params: {} });
    assert.equal(lease.success, true);
    assert.equal(engine.getKind(), "desktop");
    assert.equal(engine.getSeatId(), null);
  });

  it("forwards phone swipe / ref / launch action payloads unchanged", async () => {
    const seen: unknown[] = [];
    const fetchImpl = mockGateway({
      "POST /v1/sessions": () => ({
        status: 200,
        json: { ...leaseJson(), kind: "phone", seat_id: "phone-1" },
      }),
      "POST /v1/sessions/sess-1/action": ({ body }) => {
        seen.push(body);
        return { status: 200, json: { ok: true } };
      },
    });

    const engine = new ComputerEngine({ baseUrl: "http://gw", fetch: fetchImpl });
    await engine.execute({ type: "lease", params: { kind: "phone" } });

    const swipe = {
      type: "swipe",
      x1: 540,
      y1: 1800,
      x2: 540,
      y2: 600,
      duration_ms: 350,
    };
    const tapRef = { type: "click", ref: "e12" };
    const launch = {
      type: "launch",
      package: "com.android.settings",
      uri: "android.settings.SETTINGS",
    };

    for (const action of [swipe, tapRef, launch]) {
      const result = await engine.execute({
        type: "action",
        params: { action },
      });
      assert.equal(result.success, true);
    }

    assert.deepEqual(seen, [swipe, tapRef, launch]);
  });

  it("maps observe to GET /observe with max_elements", async () => {
    let observedSearch = "";
    const fetchImpl = mockGateway({
      "POST /v1/sessions": () => ({
        status: 200,
        json: { ...leaseJson(), kind: "phone", seat_id: "phone-1" },
      }),
      "GET /v1/sessions/sess-1/observe": ({ search }) => {
        observedSearch = search;
        return {
          status: 200,
          json: {
            ok: true,
            image: "base64png",
            elements: [
              {
                ref: "e1",
                text: "Settings",
                content_desc: "Settings",
                clickable: true,
              },
            ],
            element_count: 1,
            geometry: { width: 1080, height: 2400 },
          },
        };
      },
    });

    const engine = new ComputerEngine({ baseUrl: "http://gw", fetch: fetchImpl });
    await engine.execute({ type: "lease", params: { kind: "phone" } });

    const result = await engine.execute({
      type: "observe",
      params: { max_elements: 50 },
    });
    assert.equal(result.success, true);
    assert.match(observedSearch, /max_elements=50/);
    assert.equal(result.data?.image, "base64png");
    assert.equal(result.data?.element_count, 1);
    assert.equal(
      (result.data?.elements as Array<{ ref?: string }>)?.[0]?.ref,
      "e1"
    );
    assert.deepEqual(result.data?.geometry, { width: 1080, height: 2400 });
  });

  it("surfaces a clear error when observe returns 404 on desktop", async () => {
    const fetchImpl = mockGateway({
      "POST /v1/sessions": () => ({ status: 200, json: leaseJson() }),
      "GET /v1/sessions/sess-1/observe": () => ({
        status: 404,
        json: { detail: "Not Found" },
      }),
    });

    const engine = new ComputerEngine({ baseUrl: "http://gw", fetch: fetchImpl });
    await engine.execute({ type: "lease", params: {} });
    const result = await engine.execute({ type: "observe", params: {} });
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /phone-only/);
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
