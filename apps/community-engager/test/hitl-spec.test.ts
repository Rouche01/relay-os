import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { freezeSpec, type FeedbackRequest, type FeedbackResponse } from "@relay/protocol";
import type { FeedbackAdapter } from "@relay/feedback-broker";
import { compileEngageFromSlots } from "../src/spec/engage-compiler.js";
import {
  applySpecEdit,
  negotiateSpecBeforeRun,
  parseSpecEdit,
} from "../src/spec/hitl-spec.js";

class ScriptedAdapter implements FeedbackAdapter {
  readonly name = "scripted-test";
  constructor(private readonly fn: (req: FeedbackRequest) => FeedbackResponse) {}
  async present(request: FeedbackRequest): Promise<FeedbackResponse> {
    return this.fn(request);
  }
}

describe("parseSpecEdit", () => {
  it("parses slot lines and goal", () => {
    const p = parseSpecEdit(
      "maxJobs=2\ndryRun=false\nallowPromo=false\ngoal: Help only"
    );
    assert.equal(p.maxJobs, 2);
    assert.equal(p.dryRun, false);
    assert.equal(p.allowPromo, false);
    assert.equal(p.goal, "Help only");
  });

  it("treats freeform as goal", () => {
    assert.equal(parseSpecEdit("Scout fashion subs").goal, "Scout fashion subs");
  });
});

describe("applySpecEdit / negotiateSpecBeforeRun", () => {
  it("applies edit into a new frozen Spec version", () => {
    const { spec } = compileEngageFromSlots("Old goal", {
      maxJobs: 3,
      dryRun: true,
      allowPromo: true,
    });
    const frozen = freezeSpec(spec, { frozenBy: "t" });
    const edited = applySpecEdit(frozen, "maxJobs=1\ngoal: New goal", "editor");
    assert.equal(edited.status, "frozen");
    assert.equal(edited.goal, "New goal");
    assert.equal(edited.budget.maxJobs, 1);
    assert.equal(edited.version, frozen.version + 1);
    assert.equal(edited.id, frozen.id);
  });

  it("approve returns the Spec; abort marks aborted", async () => {
    const { spec } = compileEngageFromSlots("Approve me", { dryRun: true });
    const frozen = freezeSpec(spec, { frozenBy: "t" });

    const approved = await negotiateSpecBeforeRun({
      adapter: new ScriptedAdapter((req) => ({
        requestId: req.id,
        agentId: req.agentId,
        action: "proceed",
        value: true,
      })),
      spec: frozen,
      agentId: "a1",
    });
    assert.equal(approved.aborted, false);
    if (!approved.aborted) assert.equal(approved.spec.id, frozen.id);

    const aborted = await negotiateSpecBeforeRun({
      adapter: new ScriptedAdapter((req) => ({
        requestId: req.id,
        agentId: req.agentId,
        action: "abort",
        value: false,
      })),
      spec: frozen,
      agentId: "a1",
    });
    assert.equal(aborted.aborted, true);
    if (aborted.aborted) assert.equal(aborted.spec.status, "aborted");
  });
});
