import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  actionFingerprint,
  captureObserveObservation,
  captureScreenshotObservation,
  defaultScreenSignature,
  defaultSeatTiming,
  runSeatPolicyLoop,
  sampleWaitMs,
  shouldExit,
} from "../src/index.js";

describe("@relay/computer-seat-policy re-exports @useapron/seat", () => {
  it("exposes the seat loop API", () => {
    assert.equal(typeof runSeatPolicyLoop, "function");
    assert.equal(typeof defaultSeatTiming, "function");
    assert.equal(typeof sampleWaitMs, "function");
    assert.equal(typeof shouldExit, "function");
    assert.equal(typeof captureScreenshotObservation, "function");
    assert.equal(typeof captureObserveObservation, "function");
    assert.equal(typeof defaultScreenSignature, "function");
    assert.equal(typeof actionFingerprint, "function");
  });
});
