import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentContext, SpecV2Body } from "@relay/protocol";
import { ComputerEngine } from "@relay/engines-computer";
import {
  lowerSpecV2,
  SPEC_V2_BROWSE_NEED_HUMAN_PREFIX,
} from "@relay/spec-lower";
import {
  createWorkflowRuntime,
  getEvidence,
} from "@relay/workflow-runtime";
import { BrowsePolicyController, withBrowsePolicy } from "../src/controller.js";
import { createScriptedDecider } from "../src/decide.js";
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

function browseComputer(): ComputerEngine {
  return new ComputerEngine({
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

function browseSpec(overrides?: Partial<SpecV2Body["steps"][0]["args"]>): SpecV2Body {
  return {
    goal: "Find pricing",
    budget: { dryRun: true },
    steps: [
      {
        id: "tour",
        use: "computer.browse",
        args: {
          goal: "See plan names on pricing",
          maxSteps: 5,
          mu: 0,
          ...overrides,
        },
      },
    ],
  };
}

describe("computer.browse Spec wiring", () => {
  it("lowers with a skippable need_human feedback point", () => {
    const lowered = lowerSpecV2(browseSpec(), { name: "browse-wf" });
    const stage = lowered.manifest.stages.find((s) => s.name === "tour");
    assert.equal(stage?.engine, "computer");
    assert.equal(stage?.feedback_points?.[0]?.type, "freeform");
    assert.ok(
      stage?.feedback_points?.[0]?.description.startsWith(
        SPEC_V2_BROWSE_NEED_HUMAN_PREFIX
      )
    );
  });

  it("BrowsePolicyController completes and skips HITL when done", async () => {
    const lowered = lowerSpecV2(browseSpec(), { name: "browse-wf" });
    const computer = browseComputer();
    const ctx: AgentContext = {
      agentId: "a1",
      userId: "u1",
      sessionId: "s1",
      steps: {},
    };
    const controller = new BrowsePolicyController({
      lowered,
      getContext: () => ctx,
      decide: createScriptedDecider([{ kind: "done", reason: "ok" }]),
      timing: defaultBrowseTiming({ exitRateMu: 0, minMs: 0, maxMs: 0 }),
      engines: { computer },
    });

    const stage = lowered.manifest.stages[0]!;
    assert.equal(controller.handles(stage), true);
    await controller.onStageStart(stage, computer);

    const bag = (ctx.steps as Record<string, { output: { stoppedReason: string } }>)
      .tour;
    assert.equal(bag.output.stoppedReason, "done");
    assert.equal(
      await controller.shouldSkipFeedbackPoint(
        stage,
        stage.feedback_points![0]!,
        ctx
      ),
      true
    );
  });

  it("pauses for need_human and does not skip feedback", async () => {
    const lowered = lowerSpecV2(browseSpec(), { name: "browse-wf" });
    const computer = browseComputer();
    const ctx: AgentContext = {
      agentId: "a1",
      userId: "u1",
      sessionId: "s1",
      steps: {},
    };
    const controller = new BrowsePolicyController({
      lowered,
      getContext: () => ctx,
      decide: createScriptedDecider([
        { kind: "need_human", reason: "captcha" },
      ]),
      timing: defaultBrowseTiming({ exitRateMu: 0, minMs: 0, maxMs: 0 }),
      engines: { computer },
    });

    const stage = lowered.manifest.stages[0]!;
    await controller.onStageStart(stage, computer);

    const bag = (
      ctx.steps as Record<
        string,
        { output: { needHuman?: boolean; pending?: boolean; reason?: string } }
      >
    ).tour;
    assert.equal(bag.output.needHuman, true);
    assert.equal(bag.output.pending, true);
    assert.match(bag.output.reason ?? "", /captcha/);
    assert.equal(
      await controller.shouldSkipFeedbackPoint(
        stage,
        stage.feedback_points![0]!,
        ctx
      ),
      false
    );
  });

  it("createWorkflowRuntime decorateController runs browse and finishes", async () => {
    const lowered = lowerSpecV2(browseSpec(), { name: "browse-wf" });
    const computer = browseComputer();

    const { runtime } = createWorkflowRuntime({
      lowered,
      engines: { computer },
      context: {
        agentId: "browse-1",
        userId: "u1",
        sessionId: "s1",
      },
      assertRunnable: { validate: false },
      decorateController: (base, { getContext }) =>
        withBrowsePolicy(base, {
          lowered,
          getContext,
          decide: createScriptedDecider([{ kind: "done", reason: "ok" }]),
          timing: defaultBrowseTiming({
            exitRateMu: 0,
            minMs: 0,
            maxMs: 0,
          }),
          engines: { computer },
        }),
    });

    await runtime.start();
    assert.equal(runtime.getState(), "COMPLETE");
    const ctx = runtime.getContext();
    const bag = (
      ctx.steps as Record<string, { output: { stoppedReason: string } }>
    ).tour;
    assert.equal(bag.output.stoppedReason, "done");
    const evidence = getEvidence(ctx);
    assert.ok(evidence.some((e) => e.kind === "execute" && e.stepId === "tour"));
  });
});
