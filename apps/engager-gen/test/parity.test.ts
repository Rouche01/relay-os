import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PARITY_MAX_MEAN_DELTA,
  runParityReport,
} from "../src/parity.js";

describe("engager-gen parity", () => {
  it("stub draft mean delta ≤ 0.5 and scaffold expectations match", async () => {
    const report = await runParityReport({ stub: true });
    assert.equal(report.mode, "stub");
    assert.ok(
      report.draft.meanDelta <= PARITY_MAX_MEAN_DELTA,
      `meanDelta ${report.draft.meanDelta} > ${PARITY_MAX_MEAN_DELTA}`
    );
    assert.equal(report.draft.passed, true);
    assert.ok(report.scaffold.total >= 4);
    assert.equal(
      report.scaffold.matchedExpectation,
      report.scaffold.total,
      JSON.stringify(report.scaffold.rows, null, 2)
    );
    assert.equal(report.passed, true);
    // Fashion intents succeed; freight + nonsense fail → rate in (0,1)
    assert.ok(report.scaffold.rate > 0 && report.scaffold.rate < 1);
  });
});
