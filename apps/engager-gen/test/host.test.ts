import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runEngagerGen } from "../src/host.js";

describe("engager-gen host", () => {
  it("validate → freeze → lower → evals → dry-run completes", async () => {
    const result = await runEngagerGen({ autoApprove: true });
    assert.equal(result.evalPassed, true);
    assert.equal(result.state, "COMPLETE");
    assert.equal(result.source, "yaml");
    assert.ok(result.draftCount >= 1);
    assert.ok(result.evidenceCount >= 1);
    assert.ok(result.specHash.length > 0);
  });

  it("scaffold from intent.md (repair loop) then dry-run", async () => {
    const result = await runEngagerGen({
      autoApprove: true,
      fromIntent: true,
    });
    assert.equal(result.source, "scaffold");
    assert.equal(result.scaffoldAttempts, 2);
    assert.equal(result.evalPassed, true);
    assert.equal(result.state, "COMPLETE");
    assert.ok(result.draftCount >= 1);
  });
});
