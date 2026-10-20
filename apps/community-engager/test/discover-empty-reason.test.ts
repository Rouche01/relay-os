import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDiscoverEmptyReason } from "../src/reddit/scout/discover-subs.js";

describe("formatDiscoverEmptyReason", () => {
  it("labels search empty", () => {
    const r = formatDiscoverEmptyReason({
      searchEmpty: true,
      childCount: 0,
      excluded: 0,
      hardVeto: 0,
      fitDropped: 0,
    });
    assert.match(String(r), /search_empty/);
  });

  it("labels all excluded", () => {
    const r = formatDiscoverEmptyReason({
      childCount: 5,
      excluded: 4,
      hardVeto: 1,
      fitDropped: 0,
    });
    assert.match(String(r), /all_excluded/);
  });

  it("labels fit drops", () => {
    const r = formatDiscoverEmptyReason({
      childCount: 5,
      excluded: 1,
      hardVeto: 0,
      fitDropped: 4,
    });
    assert.match(String(r), /all_dropped_by_fit/);
  });

  it("labels hard vetoes", () => {
    const r = formatDiscoverEmptyReason({
      childCount: 3,
      excluded: 0,
      hardVeto: 3,
      fitDropped: 0,
    });
    assert.match(String(r), /all_hard_vetoed/);
  });
});
