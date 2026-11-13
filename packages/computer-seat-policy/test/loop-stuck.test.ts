import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ComputerEngine } from "@relay/engines-computer";
import { runSeatPolicyLoop } from "../src/loop.js";
import { defaultSeatTiming } from "../src/timing.js";
import type { SeatDecision, SeatObservation } from "../src/types.js";

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
    vnc_url: "http://localhost:6080/vnc.html",
    expires_at: "2099-01-01T00:00:00Z",
  };
}

const OBS_A: SeatObservation = {
  imageBase64: "aaa",
  at: "2020-01-01T00:00:00Z",
  elements: [{ ref: "e1", text: "A", clickable: true }],
};

const OBS_B: SeatObservation = {
  imageBase64: "bbb",
  at: "2020-01-01T00:00:01Z",
  elements: [{ ref: "e2", text: "B", clickable: true }],
};

function scripted(decisions: SeatDecision[]) {
  let i = 0;
  return {
    async decide(): Promise<SeatDecision> {
      if (i >= decisions.length) {
        return { kind: "done", reason: "exhausted" };
      }
      return decisions[i++]!;
    },
  };
}

function baseEngine() {
  return new ComputerEngine({
    baseUrl: "http://gw",
    fetch: mockGateway({
      "POST /v1/sessions": () => ({ status: 200, json: leaseJson() }),
      "POST /v1/sessions/sess-1/action": () => ({
        status: 200,
        json: { ok: true },
      }),
      "DELETE /v1/sessions/sess-1": () => ({
        status: 200,
        json: { ok: true },
      }),
    }),
  });
}

const timing = defaultSeatTiming({
  exitRateMu: 0,
  minMs: 0,
  maxMs: 0,
  actionRateLambda: 1,
});

describe("runSeatPolicyLoop stuck guards", () => {
  it("does not trip stuck when guards are omitted", async () => {
    const sameClick = {
      kind: "act" as const,
      action: { type: "click" as const, ref: "e1" },
    };
    const engine = baseEngine();
    let n = 0;
    const result = await runSeatPolicyLoop(engine, {
      goal: { text: "go" },
      timing,
      decide: scripted([sameClick, sameClick, sameClick, { kind: "done" }]),
      captureObservation: async () => {
        n += 1;
        return { ok: true, observation: { ...OBS_A, at: String(n) } };
      },
      maxIterations: 10,
      heartbeatEachIteration: false,
      sleep: async () => {},
    });
    assert.equal(result.success, true);
    assert.equal(result.stoppedReason, "done");
  });

  it("action streak 2 with N=3 continues; 3 stops", async () => {
    const sameClick = {
      kind: "act" as const,
      action: { type: "click" as const, ref: "e1" },
    };
    const engine = baseEngine();
    const mid = await runSeatPolicyLoop(engine, {
      goal: { text: "go" },
      timing,
      decide: scripted([sameClick, sameClick, { kind: "done" }]),
      captureObservation: async () => ({ ok: true, observation: OBS_A }),
      maxSameActionStreak: 3,
      maxIterations: 10,
      heartbeatEachIteration: false,
      sleep: async () => {},
    });
    assert.equal(mid.success, true);
    assert.equal(mid.stoppedReason, "done");

    const engine2 = baseEngine();
    const stuck = await runSeatPolicyLoop(engine2, {
      goal: { text: "go" },
      timing,
      decide: scripted([sameClick, sameClick, sameClick]),
      captureObservation: async () => ({ ok: true, observation: OBS_A }),
      maxSameActionStreak: 3,
      maxIterations: 10,
      heartbeatEachIteration: false,
      sleep: async () => {},
    });
    assert.equal(stuck.success, false);
    assert.equal(stuck.stoppedReason, "stuck");
    assert.match(stuck.error ?? "", /same action 3 times/);
    assert.equal(stuck.steps.length, 3);
  });

  it("different action on same screen resets action streak", async () => {
    const engine = baseEngine();
    const result = await runSeatPolicyLoop(engine, {
      goal: { text: "go" },
      timing,
      decide: scripted([
        { kind: "act", action: { type: "click", ref: "e1" } },
        { kind: "act", action: { type: "click", ref: "e1" } },
        { kind: "act", action: { type: "swipe", x1: 1, y1: 2, x2: 3, y2: 4 } },
        { kind: "act", action: { type: "click", ref: "e1" } },
        { kind: "act", action: { type: "click", ref: "e1" } },
        { kind: "done" },
      ]),
      captureObservation: async () => ({ ok: true, observation: OBS_A }),
      maxSameActionStreak: 3,
      maxIterations: 10,
      heartbeatEachIteration: false,
      sleep: async () => {},
    });
    assert.equal(result.success, true);
    assert.equal(result.stoppedReason, "done");
  });

  it("screen streak alone does not trip at 3 when N=6", async () => {
    const engine = baseEngine();
    const clicks = Array.from({ length: 4 }, (_, i) => ({
      kind: "act" as const,
      action: { type: "click" as const, ref: `r${i}` },
    }));
    const result = await runSeatPolicyLoop(engine, {
      goal: { text: "go" },
      timing,
      decide: scripted([...clicks, { kind: "done" }]),
      captureObservation: async () => ({ ok: true, observation: OBS_A }),
      maxSameScreenStreak: 6,
      // different refs so action streak does not fire
      maxIterations: 10,
      heartbeatEachIteration: false,
      sleep: async () => {},
    });
    assert.equal(result.success, true);
    assert.equal(result.stoppedReason, "done");
  });

  it("screen streak trips at N=6", async () => {
    const engine = baseEngine();
    // 6 acts + 7th observe of same screen after 6th act → streak 6
    const clicks = Array.from({ length: 6 }, (_, i) => ({
      kind: "act" as const,
      action: { type: "click" as const, ref: `r${i}` },
    }));
    const result = await runSeatPolicyLoop(engine, {
      goal: { text: "go" },
      timing,
      decide: scripted(clicks),
      captureObservation: async () => ({ ok: true, observation: OBS_A }),
      maxSameScreenStreak: 6,
      maxIterations: 20,
      heartbeatEachIteration: false,
      sleep: async () => {},
    });
    assert.equal(result.success, false);
    assert.equal(result.stoppedReason, "stuck");
    assert.match(result.error ?? "", /same screen signature 6 times/);
  });

  it("progressGuard can abort with stuck before decide", async () => {
    const engine = baseEngine();
    let decided = 0;
    const result = await runSeatPolicyLoop(engine, {
      goal: { text: "go" },
      timing,
      decide: {
        async decide() {
          decided += 1;
          return { kind: "act", action: { type: "click", ref: "e1" } };
        },
      },
      captureObservation: async () => ({ ok: true, observation: OBS_A }),
      progressGuard: async () => ({ ok: false, error: "phase budget" }),
      maxIterations: 5,
      heartbeatEachIteration: false,
      sleep: async () => {},
    });
    assert.equal(result.success, false);
    assert.equal(result.stoppedReason, "stuck");
    assert.match(result.error ?? "", /phase budget/);
    assert.equal(decided, 0);
  });

  it("screen change resets action streak", async () => {
    const engine = baseEngine();
    let iter = 0;
    const result = await runSeatPolicyLoop(engine, {
      goal: { text: "go" },
      timing,
      decide: scripted([
        { kind: "act", action: { type: "click", ref: "e1" } },
        { kind: "act", action: { type: "click", ref: "e1" } },
        // screen changes on next obs → action streak cleared
        { kind: "act", action: { type: "click", ref: "e1" } },
        { kind: "act", action: { type: "click", ref: "e1" } },
        { kind: "done" },
      ]),
      captureObservation: async () => {
        iter += 1;
        // After 2 acts, 3rd observation is B
        return {
          ok: true,
          observation: iter <= 2 ? OBS_A : OBS_B,
        };
      },
      maxSameActionStreak: 3,
      maxIterations: 10,
      heartbeatEachIteration: false,
      sleep: async () => {},
    });
    assert.equal(result.success, true);
    assert.equal(result.stoppedReason, "done");
  });
});
