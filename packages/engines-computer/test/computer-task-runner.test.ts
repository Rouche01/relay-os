import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { ComputerEngine } from "../src/computer-engine.js";
import { ComputerTaskRunner } from "../src/tasks/runner.js";
import type { ComputerTask } from "../src/tasks/types.js";

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

function leaseJson(sessionId = "sess-1") {
  return {
    session_id: sessionId,
    api_base: `http://gw/v1/sessions/${sessionId}`,
    vnc_url: "http://localhost:6081/vnc.html",
    expires_at: "2099-01-01T00:00:00Z",
  };
}

/** Tiny valid-ish PNG as base64 (1x1). */
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("ComputerTaskRunner", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    while (tmpDirs.length) {
      const dir = tmpDirs.pop()!;
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function evidenceDir(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "computer-task-"));
    tmpDirs.push(dir);
    return dir;
  }

  it("registers builtins and lists them", () => {
    const engine = new ComputerEngine({
      baseUrl: "http://gw",
      fetch: mockGateway({}),
    });
    const runner = new ComputerTaskRunner({ engine });
    assert.deepEqual(runner.listTasks(), [
      "capture_frame",
      "open_url",
      "tour_urls",
    ]);
  });

  it("leases, runs open_url, and releases", async () => {
    const actions: unknown[] = [];
    let leased = false;
    const fetchImpl = mockGateway({
      "POST /v1/sessions": () => {
        leased = true;
        return { status: 200, json: leaseJson() };
      },
      "POST /v1/sessions/sess-1/action": ({ body }) => {
        actions.push(body);
        return { status: 200, json: { ok: true } };
      },
      "DELETE /v1/sessions/sess-1": () => {
        leased = false;
        return { status: 200, json: { ok: true } };
      },
    });

    const engine = new ComputerEngine({
      baseUrl: "http://gw",
      agentId: "ce",
      fetch: fetchImpl,
    });
    const runner = new ComputerTaskRunner({ engine, evidenceDir: await evidenceDir() });

    const result = await runner.run(
      "open_url",
      { url: "https://example.com", settleMs: 0 },
      { jobId: "job-1" }
    );

    assert.equal(result.success, true);
    assert.equal(result.vncUrl, "http://localhost:6081/vnc.html");
    assert.deepEqual(actions, [
      { type: "key", text: "ctrl+l" },
      { type: "type", text: "https://example.com" },
      { type: "key", text: "Return" },
    ]);
    assert.equal(engine.getSessionId(), null);
    assert.equal(leased, false);
  });

  it("tour_urls opens each URL and writes evidence", async () => {
    const actions: unknown[] = [];
    let shotCount = 0;
    const fetchImpl = mockGateway({
      "POST /v1/sessions": () => ({ status: 200, json: leaseJson() }),
      "POST /v1/sessions/sess-1/action": ({ body }) => {
        actions.push(body);
        return { status: 200, json: { ok: true } };
      },
      "GET /v1/sessions/sess-1/screenshot": () => {
        shotCount += 1;
        return { status: 200, json: { image: TINY_PNG_B64 } };
      },
      "DELETE /v1/sessions/sess-1": () => ({ status: 200, json: { ok: true } }),
    });

    const dir = await evidenceDir();
    const engine = new ComputerEngine({ baseUrl: "http://gw", fetch: fetchImpl });
    const runner = new ComputerTaskRunner({ engine, evidenceDir: dir });

    const result = await runner.run(
      "tour_urls",
      {
        urls: ["https://a.example/", "https://b.example/"],
        settleMs: 0,
        paceMs: 0,
        fileStemPrefix: "prev",
      },
      { jobId: "tour-1" }
    );

    assert.equal(result.success, true);
    assert.equal(shotCount, 2);
    assert.equal(result.evidencePaths?.length, 4); // png+json × 2
    const png0 = path.join(dir, "prev-00.png");
    const meta0 = JSON.parse(await readFile(path.join(dir, "prev-00.json"), "utf8"));
    assert.equal(meta0.url, "https://a.example/");
    const buf = await readFile(png0);
    assert.ok(buf.length > 0);

    const typeActions = actions.filter(
      (a) =>
        a &&
        typeof a === "object" &&
        (a as { type?: string }).type === "type"
    );
    assert.equal(typeActions.length, 2);
  });

  it("releases on task failure after lease", async () => {
    let deleted = false;
    const fetchImpl = mockGateway({
      "POST /v1/sessions": () => ({ status: 200, json: leaseJson() }),
      "POST /v1/sessions/sess-1/action": () => ({
        status: 500,
        json: { detail: "boom" },
      }),
      "DELETE /v1/sessions/sess-1": () => {
        deleted = true;
        return { status: 200, json: { ok: true } };
      },
    });

    const engine = new ComputerEngine({ baseUrl: "http://gw", fetch: fetchImpl });
    const runner = new ComputerTaskRunner({
      engine,
      evidenceDir: await evidenceDir(),
    });
    const result = await runner.run("open_url", {
      url: "https://x",
      settleMs: 0,
    });
    assert.equal(result.success, false);
    assert.equal(deleted, true);
    assert.equal(engine.getSessionId(), null);
  });

  it("holdSession keeps the lease for a follow-up reuseSession run", async () => {
    let deleteCount = 0;
    const fetchImpl = mockGateway({
      "POST /v1/sessions": () => ({ status: 200, json: leaseJson() }),
      "POST /v1/sessions/sess-1/action": () => ({
        status: 200,
        json: { ok: true },
      }),
      "DELETE /v1/sessions/sess-1": () => {
        deleteCount += 1;
        return { status: 200, json: { ok: true } };
      },
    });

    const engine = new ComputerEngine({ baseUrl: "http://gw", fetch: fetchImpl });
    const runner = new ComputerTaskRunner({
      engine,
      evidenceDir: await evidenceDir(),
    });

    const first = await runner.run(
      "open_url",
      { url: "https://one", settleMs: 0 },
      { holdSession: true }
    );
    assert.equal(first.success, true);
    assert.equal(engine.getSessionId(), "sess-1");
    assert.equal(deleteCount, 0);

    const second = await runner.run(
      "open_url",
      { url: "https://two", settleMs: 0 },
      { reuseSession: true }
    );
    assert.equal(second.success, true);
    assert.equal(deleteCount, 1);
    assert.equal(engine.getSessionId(), null);
  });

  it("allows registering a custom task", async () => {
    const fetchImpl = mockGateway({
      "POST /v1/sessions": () => ({ status: 200, json: leaseJson() }),
      "DELETE /v1/sessions/sess-1": () => ({ status: 200, json: { ok: true } }),
    });
    const engine = new ComputerEngine({ baseUrl: "http://gw", fetch: fetchImpl });
    const runner = new ComputerTaskRunner({
      engine,
      evidenceDir: await evidenceDir(),
      registerBuiltins: false,
    });
    const custom: ComputerTask = {
      id: "ping",
      async run() {
        return { success: true, meta: { pong: true } };
      },
    };
    runner.register(custom);
    const result = await runner.run("ping");
    assert.equal(result.success, true);
    assert.equal(result.meta?.pong, true);
  });

  it("fails clearly on unknown task id", async () => {
    const engine = new ComputerEngine({
      baseUrl: "http://gw",
      fetch: mockGateway({}),
    });
    const runner = new ComputerTaskRunner({
      engine,
      registerBuiltins: false,
    });
    const result = await runner.run("nope");
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /unknown computer task/);
  });
});
