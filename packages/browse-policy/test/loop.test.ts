import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ComputerEngine } from "@relay/engines-computer";
import { createScriptedDecider } from "../src/decide.js";
import { runBrowsePolicyLoop } from "../src/loop.js";
import { defaultBrowseTiming } from "../src/timing.js";

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

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function leaseJson(sessionId = "sess-1") {
  return {
    session_id: sessionId,
    api_base: `http://gw/v1/sessions/${sessionId}`,
    vnc_url: "http://localhost:6081/vnc.html",
    expires_at: "2099-01-01T00:00:00Z",
  };
}

describe("runBrowsePolicyLoop", () => {
  it("wait → observe → act → done, then soft-parks", async () => {
    const order: string[] = [];
    const engine = new ComputerEngine({
      baseUrl: "http://gw",
      fetch: mockGateway({
        "POST /v1/sessions": () => {
          order.push("lease");
          return { status: 200, json: leaseJson() };
        },
        "POST /v1/sessions/sess-1/heartbeat": () => {
          order.push("heartbeat");
          return { status: 200, json: leaseJson() };
        },
        "GET /v1/sessions/sess-1/screenshot": () => {
          order.push("screenshot");
          return { status: 200, json: { image: TINY_PNG_B64 } };
        },
        "POST /v1/sessions/sess-1/action": ({ body }) => {
          order.push(`action:${(body as { type: string }).type}`);
          return { status: 200, json: { ok: true } };
        },
        "DELETE /v1/sessions/sess-1": () => {
          order.push("release");
          return { status: 200, json: { ok: true } };
        },
      }),
    });

    const waits: number[] = [];
    const result = await runBrowsePolicyLoop(engine, {
      goal: { text: "See homepage" },
      timing: defaultBrowseTiming({
        actionRateLambda: 1,
        exitRateMu: 0,
        minMs: 10,
        maxMs: 10,
      }),
      decide: createScriptedDecider([
        { kind: "act", action: { type: "scroll", direction: "down", amount: 2 } },
        { kind: "done", reason: "visible" },
      ]),
      maxIterations: 5,
      heartbeatEachIteration: true,
      sleep: async (ms) => {
        waits.push(ms);
      },
      random: () => 0.5,
    });

    assert.equal(result.success, true);
    assert.equal(result.stoppedReason, "done");
    assert.equal(result.steps.length, 2);
    assert.deepEqual(waits, [10, 10]);
    assert.ok(order.includes("lease"));
    assert.ok(order.includes("screenshot"));
    assert.ok(order.includes("action:scroll"));
    assert.ok(order.includes("release"));
    assert.equal(engine.getSessionId(), null);
  });

  it("phone goal leases kind=phone, uses observe, skips Firefox navigate", async () => {
    const order: string[] = [];
    let leaseBody: unknown;
    const engine = new ComputerEngine({
      baseUrl: "http://gw",
      fetch: mockGateway({
        "POST /v1/sessions": ({ body }) => {
          leaseBody = body;
          order.push("lease");
          return {
            status: 200,
            json: { ...leaseJson(), kind: "phone", seat_id: "phone-1" },
          };
        },
        "GET /v1/sessions/sess-1/observe": () => {
          order.push("observe");
          return {
            status: 200,
            json: {
              image: TINY_PNG_B64,
              elements: [{ ref: "e1", text: "Settings", clickable: true }],
              element_count: 1,
            },
          };
        },
        "POST /v1/sessions/sess-1/action": ({ body }) => {
          const a = body as { type: string; uri?: string; ref?: string };
          order.push(
            a.type === "launch"
              ? `launch:${a.uri}`
              : a.ref
                ? `action:${a.type}:ref=${a.ref}`
                : `action:${a.type}`
          );
          return { status: 200, json: { ok: true } };
        },
        "DELETE /v1/sessions/sess-1": () => {
          order.push("release");
          return { status: 200, json: { ok: true } };
        },
      }),
    });

    const result = await runBrowsePolicyLoop(engine, {
      goal: {
        text: "Open Settings",
        seatKind: "phone",
        startUrl: "https://example.com",
      },
      timing: defaultBrowseTiming({
        exitRateMu: 0,
        minMs: 0,
        maxMs: 0,
      }),
      decide: createScriptedDecider([
        { kind: "act", action: { type: "click", ref: "e1" } },
        { kind: "done", reason: "opened" },
      ]),
      maxIterations: 5,
      navigateSettleMs: 0,
      swipeSettleMs: 0,
      heartbeatEachIteration: false,
      sleep: async () => {},
    });

    assert.equal(result.success, true);
    assert.equal((leaseBody as { kind?: string }).kind, "phone");
    assert.ok(order.includes("launch:https://example.com"));
    assert.ok(order.includes("observe"));
    assert.ok(order.includes("action:click:ref=e1"));
    assert.ok(!order.includes("screenshot"));
    assert.equal(order.includes("action:key"), false); // no ctrl+l navigate
  });

  it("stops on need_human without claiming success", async () => {
    const engine = new ComputerEngine({
      baseUrl: "http://gw",
      fetch: mockGateway({
        "POST /v1/sessions": () => ({ status: 200, json: leaseJson() }),
        "POST /v1/sessions/sess-1/heartbeat": () => ({
          status: 200,
          json: leaseJson(),
        }),
        "GET /v1/sessions/sess-1/screenshot": () => ({
          status: 200,
          json: { image: TINY_PNG_B64 },
        }),
        "DELETE /v1/sessions/sess-1": () => ({
          status: 200,
          json: { ok: true },
        }),
      }),
    });

    const result = await runBrowsePolicyLoop(engine, {
      goal: { text: "Log in" },
      timing: defaultBrowseTiming({
        exitRateMu: 0,
        minMs: 0,
        maxMs: 0,
      }),
      decide: createScriptedDecider([
        { kind: "need_human", reason: "captcha" },
      ]),
      sleep: async () => {},
      heartbeatEachIteration: false,
    });

    assert.equal(result.success, false);
    assert.equal(result.stoppedReason, "need_human");
    assert.match(result.error ?? "", /captcha/);
  });
});
