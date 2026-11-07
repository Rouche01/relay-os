import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultBrowseTiming,
  sampleWaitMs,
  shouldExit,
} from "../src/timing.js";

describe("sampleWaitMs", () => {
  it("clamps to [minMs, maxMs]", () => {
    const cfg = defaultBrowseTiming({
      actionRateLambda: 0.001, // huge mean
      minMs: 100,
      maxMs: 250,
    });
    for (let i = 0; i < 40; i++) {
      const ms = sampleWaitMs(cfg, () => 0.99);
      assert.ok(ms >= 100 && ms <= 250, `got ${ms}`);
    }
  });

  it("exponential mean is roughly 1000/λ for unclamped draws", () => {
    const lambda = 0.5;
    const cfg = defaultBrowseTiming({
      actionRateLambda: lambda,
      minMs: 0,
      maxMs: 1_000_000,
      distribution: "exponential",
    });
    // Deterministic low-discrepancy-ish uniforms via sequential seeds
    let i = 0;
    const random = () => {
      i += 1;
      return (i % 997) / 997 || Number.EPSILON;
    };
    const n = 2000;
    let sum = 0;
    for (let k = 0; k < n; k++) sum += sampleWaitMs(cfg, random);
    const mean = sum / n;
    const expected = 1000 / lambda;
    assert.ok(
      Math.abs(mean - expected) / expected < 0.2,
      `mean ${mean} vs expected ${expected}`
    );
  });

  it("lognormal stays within clamps", () => {
    const cfg = defaultBrowseTiming({
      distribution: "lognormal",
      actionRateLambda: 0.4,
      minMs: 50,
      maxMs: 500,
    });
    for (let i = 0; i < 30; i++) {
      const ms = sampleWaitMs(cfg);
      assert.ok(ms >= 50 && ms <= 500);
    }
  });

  it("rejects invalid lambda", () => {
    assert.throws(() =>
      sampleWaitMs(defaultBrowseTiming({ actionRateLambda: 0 }))
    );
  });
});

describe("shouldExit", () => {
  it("never exits when mu is 0", () => {
    for (let i = 0; i < 20; i++) {
      assert.equal(shouldExit(0, () => 0), false);
    }
  });

  it("exits when random < mu", () => {
    assert.equal(shouldExit(0.3, () => 0.1), true);
    assert.equal(shouldExit(0.3, () => 0.5), false);
  });
});
