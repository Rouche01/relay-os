import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveDiscoverGate } from "../src/discover-gate.js";
import { parseDiscoverMode, seedPostableCount } from "../src/reddit/config.js";

describe("parseDiscoverMode", () => {
  it("maps aliases to auto|force|off", () => {
    assert.equal(parseDiscoverMode("auto"), "auto");
    assert.equal(parseDiscoverMode(undefined), "auto");
    assert.equal(parseDiscoverMode("force"), "force");
    assert.equal(parseDiscoverMode("true"), "force");
    assert.equal(parseDiscoverMode("1"), "force");
    assert.equal(parseDiscoverMode("off"), "off");
    assert.equal(parseDiscoverMode("false"), "off");
    assert.equal(parseDiscoverMode("weird"), "auto");
  });
});

describe("resolveDiscoverGate", () => {
  const min = seedPostableCount();

  it("off never runs", () => {
    const g = resolveDiscoverGate({
      mode: "off",
      postableCount: 0,
      minPostable: min,
      forceDiscover: true,
    });
    assert.equal(g.run, false);
    assert.match(g.reason, /off/);
  });

  it("force always runs when not off", () => {
    const g = resolveDiscoverGate({
      mode: "force",
      postableCount: 99,
      minPostable: min,
    });
    assert.equal(g.run, true);
    assert.equal(g.reason, "mode=force");
  });

  it("auto skips when postable allowlist is healthy", () => {
    const g = resolveDiscoverGate({
      mode: "auto",
      postableCount: min,
      minPostable: min,
    });
    assert.equal(g.run, false);
    assert.match(g.reason, /healthy/);
  });

  it("auto runs when postable allowlist is thin", () => {
    const g = resolveDiscoverGate({
      mode: "auto",
      postableCount: Math.max(0, min - 1),
      minPostable: min,
    });
    assert.equal(g.run, true);
    assert.match(g.reason, /thin/);
  });

  it("forceDiscover overrides healthy auto", () => {
    const g = resolveDiscoverGate({
      mode: "auto",
      postableCount: min + 5,
      minPostable: min,
      forceDiscover: true,
    });
    assert.equal(g.run, true);
    assert.equal(g.reason, "forceDiscover");
  });

  it("counts postable not proposed — healthy even with a proposed backlog", () => {
    // Gate input is already postableCount; proposed backlog is irrelevant.
    const g = resolveDiscoverGate({
      mode: "auto",
      postableCount: min,
      minPostable: min,
    });
    assert.equal(g.run, false);
  });
});
