import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { claimPhoneSeat } from "../src/claim-phone-seat.js";
import { ComputerEngine } from "../src/computer-engine.js";

type RouteHandler = (req: {
  method: string;
  path: string;
  body: unknown;
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

function leaseJson(sessionId: string, seatId = "phone1") {
  return {
    session_id: sessionId,
    api_base: `http://gw/v1/sessions/${sessionId}`,
    vnc_url: "http://localhost:6083/watch.html",
    expires_at: "2099-01-01T00:00:00Z",
    kind: "phone",
    seat_id: seatId,
  };
}

describe("claimPhoneSeat", () => {
  it("leases a free phone when available", async () => {
    const engine = new ComputerEngine({
      baseUrl: "http://gw",
      fetch: mockGateway({
        "POST /v1/sessions": ({ body }) => {
          assert.equal((body as { kind?: string }).kind, "phone");
          return { status: 200, json: leaseJson("sess-free") };
        },
      }),
    });

    const result = await claimPhoneSeat(engine, { jobId: "j1" });
    assert.equal(result.success, true);
    assert.equal(result.data?.via, "lease");
    assert.equal(engine.getSessionId(), "sess-free");
    assert.equal(engine.getKind(), "phone");
  });

  it("acquires a parked phone when lease finds none free", async () => {
    const engine = new ComputerEngine({
      baseUrl: "http://gw",
      fetch: mockGateway({
        "POST /v1/sessions": () => ({
          status: 503,
          json: { detail: "no free phone workers" },
        }),
        "GET /v1/seats": () => ({
          status: 200,
          json: {
            seats: [
              {
                id: "phone1",
                kind: "phone",
                state: "parked",
                session_id: "sess-parked",
                vnc_url: "http://localhost:6083/watch.html",
              },
            ],
          },
        }),
        "POST /v1/sessions/sess-parked/acquire": () => ({
          status: 200,
          json: leaseJson("sess-parked"),
        }),
      }),
    });

    const result = await claimPhoneSeat(engine, { jobId: "j2" });
    assert.equal(result.success, true);
    assert.equal(result.data?.via, "acquire");
    assert.equal(result.data?.resumed_parked, true);
    assert.equal(engine.getSessionId(), "sess-parked");
  });

  it("acquires an explicit session id without leasing", async () => {
    let leased = false;
    const engine = new ComputerEngine({
      baseUrl: "http://gw",
      fetch: mockGateway({
        "POST /v1/sessions": () => {
          leased = true;
          return { status: 200, json: leaseJson("should-not") };
        },
        "POST /v1/sessions/sess-explicit/acquire": () => ({
          status: 200,
          json: leaseJson("sess-explicit"),
        }),
      }),
    });

    const result = await claimPhoneSeat(engine, {
      sessionId: "sess-explicit",
    });
    assert.equal(result.success, true);
    assert.equal(result.data?.via, "acquire");
    assert.equal(leased, false);
    assert.equal(engine.getSessionId(), "sess-explicit");
  });

  it("errors clearly when phones are only leased", async () => {
    const engine = new ComputerEngine({
      baseUrl: "http://gw",
      fetch: mockGateway({
        "POST /v1/sessions": () => ({
          status: 503,
          json: { detail: "no free phone workers" },
        }),
        "GET /v1/seats": () => ({
          status: 200,
          json: {
            seats: [
              {
                id: "phone1",
                kind: "phone",
                state: "leased",
                session_id: "sess-busy",
              },
            ],
          },
        }),
      }),
    });

    const result = await claimPhoneSeat(engine);
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /no parked phone/i);
    assert.match(result.error ?? "", /phone1:leased/);
  });
});
