import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExecutionEngine } from "@relay/protocol";
import {
  ComputerEngine,
  toEngineResult,
  toExecutionEngine,
} from "../src/index.js";

describe("ExecutionEngine adapter", () => {
  it("toEngineResult copies success / data / error", () => {
    assert.deepEqual(toEngineResult({ success: true, data: { a: 1 } }), {
      success: true,
      data: { a: 1 },
    });
    assert.deepEqual(toEngineResult({ success: false, error: "nope" }), {
      success: false,
      error: "nope",
    });
  });

  it("toExecutionEngine wraps client methods for protocol bind sites", async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.pathname === "/ready") {
        return new Response(null, { status: 200 });
      }
      if (method === "POST" && url.pathname === "/v1/sessions") {
        return new Response(
          JSON.stringify({
            session_id: "sess-1",
            api_base: "http://gw/v1/sessions/sess-1",
            vnc_url: "http://localhost:6081/vnc.html",
            expires_at: "2099-01-01T00:00:00Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ detail: "nope" }), { status: 404 });
    };

    const client = new ComputerEngine({
      baseUrl: "http://gw",
      fetch: fetchImpl,
    });
    const engine: ExecutionEngine = toExecutionEngine(client);
    assert.equal(engine.type, "computer");
    assert.equal(await engine.healthCheck(), true);

    const lease = await engine.execute({ type: "lease", params: {} });
    assert.equal(lease.success, true);
    assert.equal(client.getSessionId(), "sess-1");

    await engine.teardown();
    assert.equal(client.getSessionId(), null);
  });
});
