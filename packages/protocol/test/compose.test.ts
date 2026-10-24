import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  composeFromPrimitives,
  composeIntent,
  composeIntentFromSlots,
  createIntent,
  ensurePrimitiveSafety,
  normalizePrimitiveIds,
  PRIMITIVES_COMPOSE_PACK_ID,
  type DomainPack,
} from "../src/index.js";

const sketchPack: DomainPack = {
  id: "sketch/demo",
  match: (intent) => intent.slots.pack === "sketch" || intent.slots.pack == null,
  expand: (intent) => ({
    goal: intent.goal.trim() || "Sketch goal",
    procedure: { appId: "sketch", entrypoint: "demo" },
    actionBinding: "protocol",
    allowedActions: [
      { id: "observe", description: "Observe", sideEffect: "none" },
      { id: "write", description: "Write", sideEffect: "irreversible" },
      {
        id: "pack_alias_post",
        description: "Alias",
        sideEffect: "irreversible",
        actionBinding: "browser",
      },
    ],
    acceptance: [
      { id: "done", description: "Done", kind: "gate" },
    ],
    hitlRequired: [
      {
        id: "before_write",
        description: "HITL",
        when: "before_irreversible",
      },
    ],
    budget: { dryRun: true, maxJobs: 1 },
    constraints: [{ id: "max_jobs", description: "At most 1" }],
  }),
};

describe("composeIntent", () => {
  it("expands Intent via the first matching pack", () => {
    const { intent, spec, packId } = composeIntentFromSlots(
      "Do the thing",
      { pack: "sketch" },
      { packs: [sketchPack] }
    );
    assert.equal(packId, "sketch/demo");
    assert.equal(intent.status, "compiled");
    assert.equal(intent.specId, spec.id);
    assert.equal(spec.status, "draft");
    assert.equal(spec.procedure.appId, "sketch");
    assert.ok(spec.allowedActions.some((a) => a.id === "observe"));
    assert.ok(spec.allowedActions.some((a) => a.id === "pack_alias_post"));
    assert.ok(spec.constraints.some((c) => c.id === "compose_pack"));
    assert.equal(
      spec.constraints.find((c) => c.id === "compose_pack")?.description,
      "sketch/demo"
    );
  });

  it("fails closed with no packs or no match", () => {
    assert.throws(
      () => composeIntent("x", { packs: [] }),
      /at least one domain pack/
    );
    const other: DomainPack = {
      ...sketchPack,
      id: "other",
      match: () => false,
    };
    assert.throws(
      () => composeIntent(createIntent({ goal: "x" }), { packs: [other] }),
      /No domain pack matched/
    );
  });

  it("rejects expansion without primitives", () => {
    const bad: DomainPack = {
      id: "bad",
      match: () => true,
      expand: () => ({
        goal: "g",
        procedure: { appId: "a", entrypoint: "e" },
        allowedActions: [
          { id: "only_alias", description: "x", sideEffect: "none" },
        ],
        acceptance: [{ id: "a", description: "a", kind: "gate" }],
      }),
    };
    assert.throws(
      () => composeIntent("g", { packs: [bad] }),
      /at least one Spec primitive/
    );
  });
});

describe("composeFromPrimitives", () => {
  it("builds a draft Spec from a catalog subset", () => {
    const { intent, spec, packId } = composeFromPrimitives({
      goal: "Scout and draft a reply",
      primitiveIds: ["observe", "read", "assert", "wait_human"],
      slots: { maxJobs: 2, dryRun: true },
    });
    assert.equal(packId, PRIMITIVES_COMPOSE_PACK_ID);
    assert.equal(intent.status, "compiled");
    assert.equal(spec.status, "draft");
    assert.equal(spec.procedure.appId, "relay");
    assert.equal(spec.actionBinding, "protocol");
    assert.equal(spec.budget.maxJobs, 2);
    assert.equal(spec.budget.dryRun, true);
    assert.deepEqual(
      spec.allowedActions.map((a) => a.id),
      ["observe", "read", "wait_human", "assert"]
    );
    assert.ok(!spec.allowedActions.some((a) => a.id === "write"));
    assert.equal(
      spec.constraints.find((c) => c.id === "compose_pack")?.description,
      PRIMITIVES_COMPOSE_PACK_ID
    );
  });

  it("forces wait_human + assert when write is present", () => {
    const { spec } = composeFromPrimitives({
      goal: "Post a comment after approval",
      primitiveIds: ["observe", "write"],
    });
    const ids = spec.allowedActions.map((a) => a.id);
    assert.ok(ids.includes("write"));
    assert.ok(ids.includes("wait_human"));
    assert.ok(ids.includes("assert"));
    assert.ok(
      spec.hitlRequired.some((h) => h.when === "before_irreversible")
    );
  });

  it("fails closed on empty, unknown, or blank goal", () => {
    assert.throws(
      () => composeFromPrimitives({ goal: "x", primitiveIds: [] }),
      /at least one Spec primitive/
    );
    assert.throws(
      () =>
        composeFromPrimitives({
          goal: "x",
          primitiveIds: ["scout_threads"],
        }),
      /Unknown Spec primitive/
    );
    assert.throws(
      () =>
        composeFromPrimitives({
          goal: "   ",
          primitiveIds: ["observe"],
        }),
      /non-empty goal/
    );
  });

  it("normalizePrimitiveIds dedupes and ensurePrimitiveSafety is additive", () => {
    assert.deepEqual(normalizePrimitiveIds(["read", "read", "observe"]), [
      "read",
      "observe",
    ]);
    assert.deepEqual(ensurePrimitiveSafety(["write"]), [
      "write",
      "wait_human",
      "assert",
    ]);
    assert.deepEqual(ensurePrimitiveSafety(["observe", "read"]), [
      "observe",
      "read",
    ]);
  });
});
