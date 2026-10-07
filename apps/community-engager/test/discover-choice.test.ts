import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseDiscoveryChoice,
  parseDiscoveryChoices,
} from "../src/discover.js";

describe("parseDiscoveryChoices", () => {
  it("skips empty and none tokens", () => {
    assert.deepEqual(parseDiscoveryChoices(null), { action: "skip" });
    assert.deepEqual(parseDiscoveryChoices("none (skip)"), { action: "skip" });
    assert.deepEqual(parseDiscoveryChoices("skip"), { action: "skip" });
  });

  it("promotes a single name", () => {
    assert.deepEqual(parseDiscoveryChoices("r/malehairadvice"), {
      action: "promote",
      names: ["malehairadvice"],
    });
  });

  it("promotes multiple comma- or newline-separated names", () => {
    assert.deepEqual(
      parseDiscoveryChoices("r/AusFemaleFashion, r/malehairadvice"),
      {
        action: "promote",
        names: ["AusFemaleFashion", "malehairadvice"],
      }
    );
    assert.deepEqual(
      parseDiscoveryChoices("r/a\nr/b\nr/a"),
      { action: "promote", names: ["a", "b"] }
    );
  });

  it("filters to the allowed candidate set", () => {
    assert.deepEqual(
      parseDiscoveryChoices("r/good, r/evil", ["good", "other"]),
      { action: "promote", names: ["good"] }
    );
    assert.deepEqual(
      parseDiscoveryChoices("r/evil", ["good"]),
      { action: "skip" }
    );
  });
});

describe("parseDiscoveryChoice (compat)", () => {
  it("returns the first promoted name", () => {
    assert.deepEqual(parseDiscoveryChoice("r/a, r/b"), {
      action: "promote",
      name: "a",
    });
  });
});
