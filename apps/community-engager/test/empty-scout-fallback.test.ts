import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  emptyScoutFallbackUtcDayKey,
  shouldTriggerEmptyScoutFallback,
  type EmptyScoutFallbackInput,
} from "../src/stages/discover/empty-scout-fallback.js";
import type { ScoutSubReport } from "../src/stages/scout/scout-report.js";

function base(
  over: Partial<EmptyScoutFallbackInput> & {
    subs?: ScoutSubReport[];
  } = {}
): EmptyScoutFallbackInput {
  const { subs, ...rest } = over;
  return {
    onEmptyScout: "force",
    discoverMode: "auto",
    onEmptyScoutMax: 1,
    onEmptyScoutMaxPerDay: 3,
    dailyCount: 0,
    opportunityCount: 0,
    discoverRan: false,
    discoverSkipReason: "auto:healthy postable=5≥5",
    discoverEmptyScoutAttempts: 0,
    excludedSeen: 0,
    hasChallenge: false,
    report: {
      plannedSubs: ["malefashionadvice", "femalefashionadvice"],
      subs: subs ?? [
        {
          subreddit: "malefashionadvice",
          status: "empty",
          opportunities: 0,
        },
        {
          subreddit: "femalefashionadvice",
          status: "empty",
          opportunities: 0,
        },
      ],
    },
    ...rest,
  };
}

describe("shouldTriggerEmptyScoutFallback", () => {
  it("allows force when healthy skip and fetched empty", () => {
    const d = shouldTriggerEmptyScoutFallback(base());
    assert.equal(d.ok, true);
    assert.match(d.reason, /fallback:fetchedEmpty=2/);
  });

  it("rejects when onEmptyScout is off", () => {
    const d = shouldTriggerEmptyScoutFallback(base({ onEmptyScout: "off" }));
    assert.equal(d.ok, false);
    assert.equal(d.reason, "onEmptyScout=off");
  });

  it("rejects when discover mode is off", () => {
    const d = shouldTriggerEmptyScoutFallback(base({ discoverMode: "off" }));
    assert.equal(d.ok, false);
    assert.equal(d.reason, "discover_mode=off");
  });

  it("rejects when opportunities exist", () => {
    const d = shouldTriggerEmptyScoutFallback(base({ opportunityCount: 2 }));
    assert.equal(d.ok, false);
    assert.equal(d.reason, "has_opportunities");
  });

  it("rejects when discover already ran", () => {
    const d = shouldTriggerEmptyScoutFallback(base({ discoverRan: true }));
    assert.equal(d.ok, false);
    assert.equal(d.reason, "discover_already_ran");
  });

  it("rejects when skip reason is not auto:healthy", () => {
    const d = shouldTriggerEmptyScoutFallback(
      base({ discoverSkipReason: "mode=off" })
    );
    assert.equal(d.ok, false);
    assert.match(d.reason, /discover_skip_not_healthy/);
  });

  it("rejects when run cap reached", () => {
    const d = shouldTriggerEmptyScoutFallback(
      base({ discoverEmptyScoutAttempts: 1, onEmptyScoutMax: 1 })
    );
    assert.equal(d.ok, false);
    assert.match(d.reason, /run_cap/);
  });

  it("rejects when day cap reached", () => {
    const d = shouldTriggerEmptyScoutFallback(
      base({ dailyCount: 3, onEmptyScoutMaxPerDay: 3 })
    );
    assert.equal(d.ok, false);
    assert.match(d.reason, /day_cap/);
  });

  it("rejects unresolved scout challenge", () => {
    const d = shouldTriggerEmptyScoutFallback(base({ hasChallenge: true }));
    assert.equal(d.ok, false);
    assert.equal(d.reason, "unresolved_scout_challenge");
  });

  it("rejects when all planned subs blocked or timed out", () => {
    const d = shouldTriggerEmptyScoutFallback(
      base({
        subs: [
          {
            subreddit: "malefashionadvice",
            status: "blocked",
            opportunities: 0,
            reason: "rate_limit",
          },
          {
            subreddit: "femalefashionadvice",
            status: "timed_out",
            opportunities: 0,
          },
        ],
      })
    );
    assert.equal(d.ok, false);
    assert.equal(d.reason, "hard_fail_all_subs");
  });

  it("rejects empty_due_to_exclusions when excludedSeen and no fetchedEmpty", () => {
    const d = shouldTriggerEmptyScoutFallback(
      base({
        excludedSeen: 4,
        subs: [
          {
            subreddit: "malefashionadvice",
            status: "ok",
            opportunities: 0,
          },
        ],
      })
    );
    assert.equal(d.ok, false);
    assert.equal(d.reason, "empty_due_to_exclusions");
  });

  it("rejects when fallback already done", () => {
    const d = shouldTriggerEmptyScoutFallback(
      base({ discoverEmptyScoutFallbackDone: true })
    );
    assert.equal(d.ok, false);
    assert.equal(d.reason, "fallback_already_done");
  });
});

describe("emptyScoutFallbackUtcDayKey", () => {
  it("returns YYYY-MM-DD UTC", () => {
    assert.equal(
      emptyScoutFallbackUtcDayKey(new Date("2026-10-15T22:00:00.000Z")),
      "2026-10-15"
    );
  });
});
