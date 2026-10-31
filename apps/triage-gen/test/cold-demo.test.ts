import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { runTriageColdDemo } from "../src/cold-demo.js";

describe("triage cold demo", () => {
  let dir: string;

  after(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("intent → freeze → shadow → enable → once on second tick", async () => {
    dir = mkdtempSync(join(tmpdir(), "triage-demo-"));
    const result = await runTriageColdDemo({ demoRoot: dir });
    assert.equal(result.ok, true);
    assert.equal(result.mode, "fixture");
    assert.ok(result.specHash.length > 10);
    assert.ok(result.tick1PostCount >= 1);
    assert.equal(result.tick2PostCount, 0);
    assert.ok(result.tick2OnceSkips >= 1);
  });
});
