import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ComputerEngine } from "@relay/engines-computer";
import { launchApp, launchPackage, openUri } from "../src/launch.js";

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

function leaseJson() {
  return {
    session_id: "sess-1",
    api_base: "http://gw/v1/sessions/sess-1",
    vnc_url: "http://localhost:6083/vnc.html",
    expires_at: "2099-01-01T00:00:00Z",
    kind: "phone",
    seat_id: "phone-1",
  };
}

describe("phone launch helpers", () => {
  it("launchPackage sends package action", async () => {
    let actionBody: unknown;
    const engine = new ComputerEngine({
      baseUrl: "http://gw",
      fetch: mockGateway({
        "POST /v1/sessions": () => ({ status: 200, json: leaseJson() }),
        "POST /v1/sessions/sess-1/action": ({ body }) => {
          actionBody = body;
          return { status: 200, json: { ok: true } };
        },
      }),
    });
    await engine.execute({ type: "lease", params: { kind: "phone" } });

    const result = await launchPackage(engine, "com.android.settings", 0);
    assert.equal(result.success, true);
    assert.deepEqual(actionBody, {
      type: "launch",
      package: "com.android.settings",
    });
  });

  it("openUri sends uri action", async () => {
    let actionBody: unknown;
    const engine = new ComputerEngine({
      baseUrl: "http://gw",
      fetch: mockGateway({
        "POST /v1/sessions": () => ({ status: 200, json: leaseJson() }),
        "POST /v1/sessions/sess-1/action": ({ body }) => {
          actionBody = body;
          return { status: 200, json: { ok: true } };
        },
      }),
    });
    await engine.execute({ type: "lease", params: { kind: "phone" } });

    const result = await openUri(engine, "https://example.com", 0);
    assert.equal(result.success, true);
    assert.deepEqual(actionBody, {
      type: "launch",
      uri: "https://example.com",
    });
  });

  it("launchApp requires package or uri", async () => {
    const engine = new ComputerEngine({ baseUrl: "http://gw" });
    const result = await launchApp(engine, {});
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /package and\/or uri/);
  });
});
