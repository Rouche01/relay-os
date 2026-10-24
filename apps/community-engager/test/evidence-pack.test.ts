import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { freezeSpec, type AgentContext } from "@relay/protocol";
import { compileEngageFromSlots } from "../src/spec/engage-compiler.js";
import {
  assertEngagePreExecuteEvidence,
  buildEngageJobEvidencePack,
} from "../src/spec/evidence-pack.js";
import type { CommunityDraft } from "../src/types.js";

function draft(partial: Partial<CommunityDraft> = {}): CommunityDraft {
  return {
    id: "d1",
    subreddit: "malefashionadvice",
    threadUrl: "https://reddit.com/r/x/comments/1",
    threadTitle: "fit check",
    draftText: "Helpful reply",
    intensity: 0,
    status: "approved",
    scoreTotal: 6,
    ...partial,
  } as CommunityDraft;
}

function ctx(partial: Record<string, unknown>): AgentContext {
  return {
    agentId: "test-agent",
    userId: "test-user",
    sessionId: "test-session",
    ...partial,
  } as unknown as AgentContext;
}

describe("engage evidence pack", () => {
  it("pre_execute is complete after draft + approve", () => {
    const { spec } = compileEngageFromSlots("Helpful replies", {
      dryRun: true,
      allowPromo: true,
    });
    const frozen = freezeSpec(spec, { frozenBy: "test" });
    const context = ctx({
      spec: frozen,
      currentDraft: draft(),
      hitlOutcome: "approved",
      stageResults: {},
    });

    const pack = buildEngageJobEvidencePack(frozen, context, "pre_execute");
    assert.equal(pack.complete, true);
    assert.equal(pack.blocking.length, 0);
    assert.ok(
      pack.items.find((i) => i.acceptanceId === "execute_evidence")?.status ===
        "skipped"
    );
  });

  it("blocks execute when HITL missing", () => {
    const { spec } = compileEngageFromSlots("Helpful replies", {});
    const frozen = freezeSpec(spec, { frozenBy: "test" });
    const context = ctx({
      spec: frozen,
      currentDraft: draft(),
      stageResults: {},
    });

    assert.throws(
      () => assertEngagePreExecuteEvidence(context),
      /evidence incomplete|hitl_decision/
    );
  });

  it("blocks intensity 2 without confirmation", () => {
    const { spec } = compileEngageFromSlots("Promo ok", { allowPromo: true });
    const frozen = freezeSpec(spec, { frozenBy: "test" });
    const context = ctx({
      spec: frozen,
      currentDraft: draft({ intensity: 2 }),
      hitlOutcome: "approved",
      stageResults: { hitl: {} },
    });

    assert.throws(
      () => assertEngagePreExecuteEvidence(context),
      /intensity2_gate/
    );
  });

  it("no-ops when Spec is absent (legacy path)", () => {
    const context = ctx({
      currentDraft: draft(),
      hitlOutcome: "approved",
      stageResults: {},
    });
    assert.equal(assertEngagePreExecuteEvidence(context), null);
  });
});
