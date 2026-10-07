import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  discoverExcludeNames,
  isExcludedFromDiscover,
  type AllowlistEntry,
} from "../src/allowlist-store.js";

function entry(
  partial: Partial<AllowlistEntry> & Pick<AllowlistEntry, "name" | "status">
): AllowlistEntry {
  return {
    rulesOk: true,
    note: "",
    source: "discovered",
    score: 0,
    approvedCount: 0,
    abortedCount: 0,
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

describe("isExcludedFromDiscover", () => {
  const now = new Date("2026-10-07T12:00:00.000Z");

  it("always excludes postable and rejected", () => {
    assert.equal(
      isExcludedFromDiscover(
        entry({ name: "a", status: "postable", updatedAt: "2020-01-01T00:00:00.000Z" }),
        { requeueDays: 14, now }
      ),
      true
    );
    assert.equal(
      isExcludedFromDiscover(
        entry({ name: "b", status: "rejected", updatedAt: "2020-01-01T00:00:00.000Z" }),
        { requeueDays: 14, now }
      ),
      true
    );
  });

  it("excludes fresh proposed within TTL", () => {
    assert.equal(
      isExcludedFromDiscover(
        entry({
          name: "fresh",
          status: "proposed",
          updatedAt: "2026-10-01T12:00:00.000Z", // 6 days ago
        }),
        { requeueDays: 14, now }
      ),
      true
    );
  });

  it("allows stale proposed after TTL", () => {
    assert.equal(
      isExcludedFromDiscover(
        entry({
          name: "stale",
          status: "proposed",
          updatedAt: "2026-09-01T12:00:00.000Z", // 36 days ago
        }),
        { requeueDays: 14, now }
      ),
      false
    );
  });

  it("requeueDays=0 never re-queues proposed", () => {
    assert.equal(
      isExcludedFromDiscover(
        entry({
          name: "old",
          status: "proposed",
          updatedAt: "2020-01-01T00:00:00.000Z",
        }),
        { requeueDays: 0, now }
      ),
      true
    );
  });
});

describe("discoverExcludeNames", () => {
  const now = new Date("2026-10-07T12:00:00.000Z");

  it("returns postable + rejected + fresh proposed only", () => {
    const names = discoverExcludeNames(
      [
        entry({ name: "postable_sub", status: "postable" }),
        entry({ name: "rejected_sub", status: "rejected" }),
        entry({
          name: "fresh_prop",
          status: "proposed",
          updatedAt: "2026-10-05T12:00:00.000Z",
        }),
        entry({
          name: "stale_prop",
          status: "proposed",
          updatedAt: "2026-08-01T12:00:00.000Z",
        }),
      ],
      { requeueDays: 14, now }
    );
    assert.deepEqual(names.sort(), [
      "fresh_prop",
      "postable_sub",
      "rejected_sub",
    ]);
  });
});
