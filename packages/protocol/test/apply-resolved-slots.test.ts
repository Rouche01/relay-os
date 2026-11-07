import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyResolvedSlots,
  getResolvedCandidate,
  type CapabilitySlot,
  type SpecV2Body,
} from "../src/index.js";

function scmSlot(
  overrides: Partial<CapabilitySlot> = {}
): CapabilitySlot {
  return {
    id: "scm.issues",
    needs: ["list issues", "comment"],
    candidates: [
      {
        binding: "api",
        status: "live",
        service: "github",
        connection: "github:default",
        rank: 0,
      },
      {
        binding: "api",
        status: "degraded",
        service: "http-fetch",
        rank: 20,
      },
      {
        binding: "human",
        status: "available",
        rank: 90,
      },
    ],
    resolved: null,
    ...overrides,
  };
}

function triageBody(slot: CapabilitySlot): SpecV2Body {
  return {
    goal: "Triage bugs",
    connections: ["github:default"],
    services: ["github"],
    slots: [slot],
    steps: [
      {
        id: "scout",
        use: "api.request",
        args: {
          slot: "scm.issues",
          operation: "issuesListForRepo",
          params: { owner: "acme", repo: "widgets" },
        },
      },
      {
        id: "approve",
        use: "human.approve",
        args: { show: "${steps.scout.output}", prompt: "OK?" },
      },
    ],
  };
}

describe("applyResolvedSlots (cs4)", () => {
  it("leaves ASAP bodies without step slot refs unchanged", () => {
    const body: SpecV2Body = {
      goal: "Triage",
      services: ["github"],
      slots: [scmSlot()],
      steps: [
        {
          id: "scout",
          use: "api.request",
          args: { service: "github", operation: "issuesListForRepo" },
        },
      ],
    };
    const out = applyResolvedSlots(body);
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.deepEqual(out.rewrittenStepIds, []);
    assert.equal(
      (out.body.steps[0]!.args as { service?: string }).service,
      "github"
    );
  });

  it("rewrites service/connection from resolved slot without changing goal/step ids", () => {
    const slot = scmSlot({
      resolved: "github:default",
      preferredCandidateIndex: 0,
    });
    const out = applyResolvedSlots(triageBody(slot));
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.deepEqual(
      out.body.steps.map((s) => s.id),
      ["scout", "approve"]
    );
    assert.equal(out.body.goal, "Triage bugs");
    const args = out.body.steps[0]!.args as Record<string, unknown>;
    assert.equal(args.service, "github");
    assert.equal(args.connection, "github:default");
    assert.equal(args.slot, "scm.issues");
    assert.ok(out.rewrittenStepIds.includes("scout"));
  });

  it("swaps to degraded http-fetch without rewriting Spec law", () => {
    const slot = scmSlot({
      resolved: "http-fetch:slot",
      preferredCandidateIndex: 1,
    });
    const out = applyResolvedSlots(triageBody(slot));
    assert.equal(out.ok, true);
    if (!out.ok) return;
    const args = out.body.steps[0]!.args as Record<string, unknown>;
    assert.equal(args.service, "http-fetch");
    assert.equal(out.body.goal, "Triage bugs");
    assert.ok(out.body.services?.includes("http-fetch"));
  });

  it("fails closed when step refs an unresolved slot", () => {
    const out = applyResolvedSlots(triageBody(scmSlot({ resolved: null })));
    assert.equal(out.ok, false);
    if (out.ok) return;
    assert.ok(out.errors.some((e) => /not resolved/i.test(e)));
  });

  it("remaps human binding onto human.edit without rewriting Spec law", () => {
    const slot = scmSlot({
      resolved: "binding:human",
      preferredCandidateIndex: 2,
    });
    const out = applyResolvedSlots(triageBody(slot));
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.body.steps[0]!.use, "human.edit");
    assert.equal(out.body.goal, "Triage bugs");
    assert.deepEqual(
      out.body.steps.map((s) => s.id),
      ["scout", "approve"]
    );
    const args = out.body.steps[0]!.args as Record<string, unknown>;
    assert.equal(args.slot, "scm.issues");
    assert.ok(args.show);
    assert.equal(args.service, undefined);
  });

  it("remaps computer binding onto computer.observe", () => {
    const slot: CapabilitySlot = {
      id: "youtube.discover",
      needs: ["search creators"],
      candidates: [
        {
          binding: "computer",
          status: "available",
          rank: 40,
        },
      ],
      resolved: "binding:computer",
      preferredCandidateIndex: 0,
    };
    const body: SpecV2Body = {
      goal: "Find creators",
      slots: [slot],
      steps: [
        {
          id: "scout",
          use: "api.request",
          args: {
            slot: "youtube.discover",
            operation: "get",
            params: { url: "https://www.youtube.com" },
          },
        },
      ],
    };
    const out = applyResolvedSlots(body);
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.body.steps[0]!.use, "computer.observe");
    assert.equal(out.body.goal, "Find creators");
  });

  it("getResolvedCandidate prefers preferredCandidateIndex", () => {
    const cand = getResolvedCandidate(
      scmSlot({ resolved: "x", preferredCandidateIndex: 1 })
    );
    assert.equal(cand?.service, "http-fetch");
  });
});
