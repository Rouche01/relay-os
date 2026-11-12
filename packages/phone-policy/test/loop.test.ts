import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ComputerEngine } from "@relay/engines-computer";
import { createScriptedPhoneDecider } from "../src/decide.js";
import { runPhonePolicyLoop } from "../src/loop.js";
import { defaultPhoneTiming } from "../src/timing.js";

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
    vnc_url: "http://localhost:6083/vnc.html",
    expires_at: "2099-01-01T00:00:00Z",
    kind: "phone",
    seat_id: "phone-1",
  };
}

describe("runPhonePolicyLoop", () => {
  it("leases kind=phone, launches package, observes, acts, parks", async () => {
    const order: string[] = [];
    let leaseBody: unknown;
    const engine = new ComputerEngine({
      baseUrl: "http://gw",
      fetch: mockGateway({
        "POST /v1/sessions": ({ body }) => {
          leaseBody = body;
          order.push("lease");
          return { status: 200, json: leaseJson() };
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
          const a = body as { type: string; package?: string; ref?: string };
          if (a.type === "launch") {
            order.push(`launch:${a.package}`);
          } else if (a.ref) {
            order.push(`action:${a.type}:ref=${a.ref}`);
          } else {
            order.push(`action:${a.type}`);
          }
          return { status: 200, json: { ok: true } };
        },
        "DELETE /v1/sessions/sess-1": () => {
          order.push("release");
          return { status: 200, json: { ok: true } };
        },
      }),
    });

    const result = await runPhonePolicyLoop(engine, {
      goal: {
        text: "Open Settings",
        package: "com.android.settings",
      },
      timing: defaultPhoneTiming({
        exitRateMu: 0,
        minMs: 0,
        maxMs: 0,
      }),
      decide: createScriptedPhoneDecider([
        { kind: "act", action: { type: "click", ref: "e1" } },
        { kind: "done", reason: "opened" },
      ]),
      maxIterations: 5,
      launchSettleMs: 0,
      swipeSettleMs: 0,
      heartbeatEachIteration: false,
      sleep: async () => {},
    });

    assert.equal(result.success, true);
    assert.equal((leaseBody as { kind?: string }).kind, "phone");
    assert.ok(order.includes("launch:com.android.settings"));
    assert.ok(order.includes("observe"));
    assert.ok(order.includes("action:click:ref=e1"));
    assert.ok(order.includes("release"));
    assert.ok(!order.includes("screenshot"));
  });

  it("stops on need_human without claiming success", async () => {
    const engine = new ComputerEngine({
      baseUrl: "http://gw",
      fetch: mockGateway({
        "POST /v1/sessions": () => ({ status: 200, json: leaseJson() }),
        "GET /v1/sessions/sess-1/observe": () => ({
          status: 200,
          json: { image: TINY_PNG_B64, elements: [] },
        }),
        "DELETE /v1/sessions/sess-1": () => ({
          status: 200,
          json: { ok: true },
        }),
      }),
    });

    const result = await runPhonePolicyLoop(engine, {
      goal: { text: "Log in" },
      timing: defaultPhoneTiming({ exitRateMu: 0, minMs: 0, maxMs: 0 }),
      decide: createScriptedPhoneDecider([
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
