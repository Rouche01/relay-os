import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { freezeSpec, markSpecRunning } from "@relay/protocol";
import { compileEngageFromSlots } from "../src/spec/engage-compiler.js";
import {
  activateSpecForRun,
  bindingsFromSpec,
  resolveMaxJobs,
} from "../src/spec/runtime-bind.js";

describe("bindingsFromSpec", () => {
  it("returns null for draft Spec", () => {
    const { spec } = compileEngageFromSlots("x", { maxJobs: 2, dryRun: true });
    assert.equal(bindingsFromSpec(spec), null);
  });

  it("reads maxJobs, dryRun, forceDiscover, allowPromo from frozen Spec", () => {
    const { spec } = compileEngageFromSlots("Helpful only", {
      maxJobs: 1,
      dryRun: true,
      forceDiscover: true,
      allowPromo: false,
    });
    const frozen = freezeSpec(spec, { frozenBy: "test" });
    const b = bindingsFromSpec(frozen);
    assert.ok(b);
    assert.equal(b!.maxJobs, 1);
    assert.equal(b!.dryRun, true);
    assert.equal(b!.forceDiscover, true);
    assert.equal(b!.allowPromo, false);
  });

  it("allows live when budget.dryRun is false", () => {
    const { spec } = compileEngageFromSlots("Live ok", {
      dryRun: false,
      allowPromo: true,
    });
    const frozen = freezeSpec(spec, { frozenBy: "test" });
    assert.equal(bindingsFromSpec(frozen)!.dryRun, false);
  });
});

describe("resolveMaxJobs", () => {
  it("takes the minimum of Spec, option, and fallback", () => {
    const { spec } = compileEngageFromSlots("cap", { maxJobs: 2 });
    const frozen = freezeSpec(spec, { frozenBy: "test" });
    assert.equal(
      resolveMaxJobs({ spec: frozen, optionMaxJobs: 5, fallback: 10 }),
      2
    );
    assert.equal(
      resolveMaxJobs({ spec: frozen, optionMaxJobs: 1, fallback: 10 }),
      1
    );
  });
});

describe("activateSpecForRun", () => {
  it("marks frozen Spec running", () => {
    const { spec } = compileEngageFromSlots("go", {});
    const frozen = freezeSpec(spec, { frozenBy: "test" });
    const active = activateSpecForRun(frozen);
    assert.equal(active?.status, "running");
    assert.equal(activateSpecForRun(markSpecRunning(frozen))?.status, "running");
  });
});
