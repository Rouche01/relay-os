import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SpecV2Body } from "@relay/protocol";
import { AgentRuntimeEvent } from "@relay/protocol";
import { createDataEngine } from "@relay/engines-data";
import { lowerSpecV2 } from "@relay/spec-lower";
import {
  createWorkflowRuntime,
  getEvidence,
} from "../src/index.js";

function dataOnlySpec(): SpecV2Body {
  return {
    goal: "Store a note and append an outcome",
    budget: { dryRun: true, maxJobs: 2 },
    rules: [
      {
        id: "status_ok",
        kind: "hard",
        check: { eq: "${output.written}", value: true },
      },
    ],
    steps: [
      {
        id: "save",
        use: "data.put",
        args: {
          store: "notes",
          key: "n1",
          value: { text: "hello" },
        },
        enforce: ["status_ok"],
      },
      {
        id: "load",
        use: "data.get",
        args: { store: "notes", key: "n1" },
      },
      {
        id: "log",
        use: "data.append",
        args: {
          store: "outcomes",
          value: "${steps.load.output}",
        },
      },
    ],
  };
}

function fanoutSpec(): SpecV2Body {
  return {
    goal: "Fanout over items and put each",
    budget: { maxJobs: 2, dryRun: true },
    steps: [
      {
        id: "seed",
        use: "data.put",
        args: {
          store: "meta",
          key: "items",
          value: [
            { id: "a", text: "one" },
            { id: "b", text: "two" },
            { id: "c", text: "three" },
          ],
        },
      },
      {
        id: "read",
        use: "data.get",
        args: { store: "meta", key: "items" },
      },
      {
        id: "write_each",
        use: "data.put",
        forEach: "${steps.read.output.value}",
        args: {
          store: "out",
          key: "${item.id}",
          value: "${item.text}",
        },
      },
    ],
  };
}

describe("createWorkflowRuntime", () => {
  it("runs a linear data workflow with enforce + evidence", async () => {
    const lowered = lowerSpecV2(dataOnlySpec(), { name: "data-wf" });
    const data = createDataEngine();
    const { runtime } = createWorkflowRuntime({
      lowered,
      engines: { data },
      context: {
        agentId: "wf-1",
        userId: "u1",
        sessionId: "s1",
      },
      assertRunnable: { validate: false },
    });

    await runtime.start();
    assert.equal(runtime.getState(), "COMPLETE");

    const ctx = runtime.getContext();
    const saveOut = (ctx.steps as Record<string, { output: unknown }>).save
      ?.output as { written?: boolean };
    assert.equal(saveOut?.written, true);

    const loadOut = (ctx.steps as Record<string, { output: unknown }>).load
      ?.output as { value?: { text?: string } };
    assert.equal(loadOut?.value?.text, "hello");

    const evidence = getEvidence(ctx);
    assert.ok(evidence.some((e) => e.kind === "execute" && e.stepId === "save"));
    assert.ok(evidence.some((e) => e.kind === "enforce" && e.stepId === "save"));
  });

  it("fails closed when hard enforce fails", async () => {
    const body = dataOnlySpec();
    body.rules = [
      {
        id: "never",
        kind: "hard",
        check: { eq: "${output.written}", value: false },
      },
    ];
    body.steps[0]!.enforce = ["never"];
    const lowered = lowerSpecV2(body);
    const { runtime } = createWorkflowRuntime({
      lowered,
      engines: { data: createDataEngine() },
      context: { agentId: "a", userId: "u", sessionId: "s" },
      assertRunnable: false,
    });

    let err: unknown;
    runtime.on(AgentRuntimeEvent.ERROR, (e) => {
      err = e;
    });
    await runtime.start();
    assert.equal(runtime.getState(), "FAILED");
    assert.ok(err instanceof Error);
  });

  it("fans out forEach and writes child outputs onto parent steps", async () => {
    const lowered = lowerSpecV2(fanoutSpec(), { name: "fanout-wf" });
    const data = createDataEngine();
    const { runtime } = createWorkflowRuntime({
      lowered,
      engines: { data },
      context: { agentId: "a", userId: "u", sessionId: "s" },
      assertRunnable: { validate: false },
    });

    await runtime.start();
    assert.equal(runtime.getState(), "COMPLETE");

    const ctx = runtime.getContext();
    const outs = (ctx.steps as Record<string, { output: unknown }>).write_each
      ?.output;
    assert.ok(Array.isArray(outs));
    assert.equal(outs.length, 2); // maxJobs=2

    const a = await data.execute({
      type: "get",
      params: { store: "out", key: "a" },
    });
    assert.equal(a.data.value, "one");
  });

  it("HITL approve then continue", async () => {
    const body: SpecV2Body = {
      goal: "Put then approve",
      steps: [
        {
          id: "save",
          use: "data.put",
          args: { store: "x", key: "k", value: 1 },
        },
        {
          id: "approve",
          use: "human.approve",
          args: { show: "${steps.save.output}", prompt: "OK?" },
        },
        {
          id: "log",
          use: "data.append",
          args: { store: "log", value: "${steps.approve.output}" },
        },
      ],
    };
    const lowered = lowerSpecV2(body);
    const { runtime } = createWorkflowRuntime({
      lowered,
      engines: { data: createDataEngine() },
      context: { agentId: "a", userId: "u", sessionId: "s" },
      assertRunnable: false,
    });

    const startP = runtime.start();
    await new Promise<void>((resolve) => {
      runtime.once(AgentRuntimeEvent.FEEDBACK_REQUESTED, async (req) => {
        assert.match(req.prompt, /OK/);
        await runtime.provideFeedback({
          requestId: req.id,
          agentId: req.agentId,
          action: "proceed",
          value: true,
        });
        resolve();
      });
    });
    await startP;
    assert.equal(runtime.getState(), "COMPLETE");
    const approve = (runtime.getContext().steps as Record<string, { output: { approved?: boolean } }>)
      .approve?.output;
    assert.equal(approve?.approved, true);
  });
});
