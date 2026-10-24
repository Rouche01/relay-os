import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HeuristicDecisionBackend,
  createDecisionPort,
  pickPrimitivesForGoal,
  suggestPrimitivesHeuristic,
  wrapBackend,
} from "../src/index.js";

describe("suggestPrimitivesHeuristic", () => {
  it("always includes observe + read", () => {
    const ids = suggestPrimitivesHeuristic("Summarize inbox status");
    assert.ok(ids.includes("observe"));
    assert.ok(ids.includes("read"));
  });

  it("maps engage-like goals toward write + HITL + assert", () => {
    const ids = suggestPrimitivesHeuristic(
      "Scout Reddit and draft replies, then post after approval"
    );
    assert.ok(ids.includes("write"));
    assert.ok(ids.includes("wait_human"));
    assert.ok(ids.includes("assert"));
    assert.ok(ids.includes("navigate"));
  });

  it("fails closed on blank goal", () => {
    assert.throws(() => suggestPrimitivesHeuristic("  "), /non-empty/);
  });
});

describe("pickPrimitivesForGoal", () => {
  it("selects catalog ids via heuristic DecisionPort", async () => {
    const port = wrapBackend(new HeuristicDecisionBackend());
    const result = await pickPrimitivesForGoal(
      port,
      "Browse the site and post a comment after human approve"
    );
    assert.equal(result.backendName, "heuristic");
    assert.ok(result.primitiveIds.includes("observe"));
    assert.ok(result.primitiveIds.includes("write"));
    assert.ok(result.primitiveIds.includes("wait_human"));
    assert.ok(result.primitiveIds.includes("navigate"));
    assert.ok(!result.primitiveIds.includes("scout_threads" as never));
  });

  it("composes with createDecisionPort default heuristic", async () => {
    const port = createDecisionPort({ backend: "heuristic" });
    const { primitiveIds } = await pickPrimitivesForGoal(
      port,
      "Read allowlist and verify score gate"
    );
    assert.ok(primitiveIds.includes("read"));
    assert.ok(primitiveIds.includes("assert"));
  });

  it("fails closed when confidence floor is unmet", async () => {
    const port = wrapBackend({
      name: "stub",
      async decide() {
        return {
          answers: {
            observe: { kind: "noul", yes: true },
          },
          confidence: 0.1,
        };
      },
    });
    await assert.rejects(
      () => pickPrimitivesForGoal(port, "Anything", { minConfidence: 0.5 }),
      /confidence too low/
    );
  });

  it("fails closed when no noul answers are yes", async () => {
    const port = wrapBackend({
      name: "stub",
      async decide(request) {
        const answers: Record<string, { kind: "noul"; yes: boolean }> = {};
        for (const q of request.questions) {
          answers[q.id] = { kind: "noul", yes: false };
        }
        return { answers, confidence: 0.9 };
      },
    });
    await assert.rejects(
      () => pickPrimitivesForGoal(port, "Anything"),
      /no catalog primitives/
    );
  });
});
