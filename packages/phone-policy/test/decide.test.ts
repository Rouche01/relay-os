import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeDecisionKind, parseDecision } from "../src/decide.js";

describe("normalizeDecisionKind", () => {
  it("accepts act aliases", () => {
    assert.equal(normalizeDecisionKind("act"), "act");
    assert.equal(normalizeDecisionKind("action"), "act");
    assert.equal(normalizeDecisionKind("ACTION"), "act");
  });

  it("accepts done / need_human variants", () => {
    assert.equal(normalizeDecisionKind("done"), "done");
    assert.equal(normalizeDecisionKind("need_human"), "need_human");
    assert.equal(normalizeDecisionKind("need-human"), "need_human");
  });

  it("rejects unknown kinds", () => {
    assert.equal(normalizeDecisionKind("click"), null);
  });
});

describe("parseDecision", () => {
  it("maps kind action to act with phone action fields", () => {
    const d = parseDecision(
      JSON.stringify({
        kind: "action",
        reason: "open chat",
        action: {
          type: "click",
          ref: "e3",
          package: "org.telegram.messenger",
        },
      })
    );
    assert.equal(d.kind, "act");
    assert.equal(d.action?.type, "click");
    assert.equal(d.action?.ref, "e3");
    assert.equal(d.action?.package, "org.telegram.messenger");
  });
});
