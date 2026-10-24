import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDraftSpec,
  createProtocolEngineStub,
  freezeSpec,
} from "@relay/protocol";

describe("ProtocolEngineStub (sketch)", () => {
  function frozenPrimitiveSpec(dryRun = true) {
    const draft = createDraftSpec({
      goal: "Protocol sketch smoke",
      procedure: { appId: "sketch", entrypoint: "compose" },
      actionBinding: "protocol",
      budget: { dryRun, maxJobs: 1 },
      allowedActions: [
        {
          id: "observe",
          description: "Observe",
          sideEffect: "none",
        },
        {
          id: "write",
          description: "Write",
          sideEffect: "irreversible",
        },
        {
          id: "assert",
          description: "Assert",
          sideEffect: "none",
        },
      ],
      acceptance: [
        {
          id: "gate_ok",
          description: "Gate",
          kind: "gate",
        },
      ],
      hitlRequired: [
        {
          id: "before_write",
          description: "HITL before write",
          when: "before_irreversible",
        },
      ],
    });
    return freezeSpec(draft, { frozenBy: "test" });
  }

  it("declares frozen Spec and refuses out-of-spec actions", async () => {
    const engine = createProtocolEngineStub();
    const spec = frozenPrimitiveSpec();
    const session = await engine.declare(spec);

    const denied = await session.invoke({
      actionId: "launch_nukes",
      primitive: "invoke",
    });
    assert.equal(denied.success, false);
    assert.match(denied.error ?? "", /not allowed/i);

    const obs = await session.observe({ query: "world" });
    assert.equal(obs.query, "world");
    assert.equal(obs.data.stub, true);

    await session.teardown();
  });

  it("simulates irreversible write under dryRun", async () => {
    const engine = createProtocolEngineStub();
    const session = await engine.declare(frozenPrimitiveSpec(true));
    const result = await session.invoke({
      actionId: "write",
      primitive: "write",
      params: { body: "hello" },
    });
    assert.equal(result.success, true);
    assert.equal(result.dryRunSimulated, true);
    await session.teardown();
  });

  it("evidence pack uses shared evaluator", async () => {
    const engine = createProtocolEngineStub();
    const session = await engine.declare(frozenPrimitiveSpec());
    let pack = session.evidence("pre_execute");
    assert.equal(pack.complete, false);
    assert.ok(pack.blocking.includes("gate_ok"));

    session.recordEvidence("gate_ok", {
      status: "satisfied",
      detail: "stub",
    });
    pack = session.evidence("pre_execute");
    assert.equal(pack.complete, true);

    const asserted = await session.invoke({
      actionId: "assert",
      primitive: "assert",
      params: { acceptanceId: "gate_ok" },
    });
    assert.equal(asserted.success, true);
    await session.teardown();
  });

  it("refuses declare on draft Spec", async () => {
    const engine = createProtocolEngineStub();
    const draft = createDraftSpec({
      goal: "draft",
      procedure: { appId: "sketch", entrypoint: "compose" },
      allowedActions: [],
      acceptance: [
        { id: "a", description: "a", kind: "gate" },
      ],
    });
    await assert.rejects(() => engine.declare(draft), /frozen\|running/);
  });
});
