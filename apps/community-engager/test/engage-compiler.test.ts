import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { freezeSpec, thawSpec } from "@relay/protocol";
import {
  COMMUNITY_ENGAGER_APP_ID,
  compileEngageFromSlots,
  compileEngageIntent,
  resolveFeedbackAdapterFromSpec,
  resolveFeedbackAdapterSlot,
} from "../src/spec/engage-compiler.js";
import { composeCommunityFromSlots } from "../src/spec/compose-intent.js";

describe("compileEngageIntent (compose + packs)", () => {
  it("compiles engage defaults into a draft Spec bound to community-engager", () => {
    const { intent, spec, packId } = compileEngageFromSlots(
      "Helpful replies in fashion subs",
      {},
      { defaults: { maxJobs: 2, dryRun: true } }
    );

    assert.equal(intent.status, "compiled");
    assert.equal(intent.specId, spec.id);
    assert.equal(spec.status, "draft");
    assert.equal(spec.intentId, intent.id);
    assert.equal(spec.procedure.appId, COMMUNITY_ENGAGER_APP_ID);
    assert.equal(spec.procedure.entrypoint, "engage");
    assert.equal(spec.actionBinding, "browser");
    assert.equal(spec.budget.maxJobs, 2);
    assert.equal(spec.budget.dryRun, true);
    assert.equal(packId, "community-engager/engage");
    assert.ok(spec.acceptance.length >= 1);
    assert.ok(spec.allowedActions.some((a) => a.id === "post_comment"));
    assert.ok(
      spec.allowedActions.find((a) => a.id === "post_comment")?.sideEffect ===
        "irreversible"
    );
    assert.ok(spec.constraints.some((c) => c.id === "hitl_before_post"));
    assert.ok(spec.hitlRequired.some((h) => h.when === "before_irreversible"));
    assert.equal(
      spec.constraints.find((c) => c.id === "compose_pack")?.description,
      "community-engager/engage"
    );
    assert.ok(spec.allowedActions.some((a) => a.id === "observe"));
    assert.ok(spec.allowedActions.some((a) => a.id === "write"));
    assert.ok(spec.allowedActions.some((a) => a.id === "wait_human"));
  });

  it("composeCommunityFromSlots selects post_watch pack", () => {
    const { packId, spec } = composeCommunityFromSlots("Watch", {
      entrypoint: "post_watch",
    });
    assert.equal(packId, "community-engager/post_watch");
    assert.equal(spec.procedure.entrypoint, "post_watch");
    assert.ok(spec.allowedActions.some((a) => a.id === "assert"));
  });

  it("honors slots for post_watch, maxJobs, dryRun, allowPromo", () => {
    const { spec } = compileEngageFromSlots("Watch posts", {
      entrypoint: "post_watch",
      maxJobs: 1,
      dryRun: false,
      allowPromo: false,
    });

    assert.equal(spec.procedure.entrypoint, "post_watch");
    assert.equal(spec.budget.maxJobs, 1);
    assert.equal(spec.budget.dryRun, false);
    assert.ok(spec.allowedActions.some((a) => a.id === "post_watch"));
    assert.ok(!spec.allowedActions.some((a) => a.id === "scout_threads"));
    assert.ok(spec.constraints.some((c) => c.id === "no_promo"));
    assert.ok(!spec.acceptance.some((a) => a.id === "intensity2_gate"));
  });

  it("forceDiscover adds constraint on engage", () => {
    const { spec } = compileEngageFromSlots("Engage with discover", {
      forceDiscover: true,
    });
    assert.ok(spec.constraints.some((c) => c.id === "force_discover"));
  });

  it("adapter slot records cli|telegram on Spec constraints", () => {
    const { intent, spec: tg } = compileEngageFromSlots("Scout", {
      adapter: "telegram",
    });
    assert.equal(intent.slots.adapter, "telegram");
    assert.ok(tg.constraints.some((c) => c.id === "hitl_adapter_telegram"));
    assert.equal(resolveFeedbackAdapterFromSpec(tg), "telegram");

    const { spec: cli } = compileEngageFromSlots("Scout", { adapter: "cli" });
    assert.ok(cli.constraints.some((c) => c.id === "hitl_adapter_cli"));
    assert.equal(resolveFeedbackAdapterFromSpec(cli), "cli");

    assert.equal(resolveFeedbackAdapterSlot({ adapter: "tg" }), "telegram");
    assert.equal(resolveFeedbackAdapterSlot({ adapter: "terminal" }), "cli");
    assert.equal(resolveFeedbackAdapterSlot({}), undefined);
  });

  it("freeze requires acceptance and thaw bumps version", () => {
    const { spec } = compileEngageIntent("Scout and draft");
    const frozen = freezeSpec(spec, { frozenBy: "test" });
    assert.equal(frozen.status, "frozen");
    assert.equal(frozen.frozenBy, "test");
    assert.ok(frozen.frozenAt);

    const draft = thawSpec(frozen);
    assert.equal(draft.status, "draft");
    assert.equal(draft.version, frozen.version + 1);
    assert.equal(draft.frozenAt, undefined);
  });
});
