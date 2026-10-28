import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runEngagerGen } from "../src/host.js";

describe("engager-gen host", () => {
  it("validate → freeze → lower → evals → dry-run completes", async () => {
    const result = await runEngagerGen({ autoApprove: true });
    assert.equal(result.evalPassed, true);
    assert.equal(result.state, "COMPLETE");
    assert.ok(result.draftCount >= 1);
    assert.ok(result.evidenceCount >= 1);
    assert.ok(result.specHash.length > 0);
  });
});
