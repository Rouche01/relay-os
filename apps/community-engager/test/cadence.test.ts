import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cadenceBlocksIntensity,
  countPostedToday,
  evaluateCadence,
  formatCadenceLog,
  localDayKey,
  trimOpportunitiesForCadence,
} from "../src/cadence.js";
import type { PromoLedgerEntry } from "../src/promo-ratio.js";

function entry(
  hoursAgo: number,
  intensity: 0 | 1 | 2,
  nowMs: number
): PromoLedgerEntry {
  return {
    postedAt: new Date(nowMs - hoursAgo * 60 * 60 * 1000).toISOString(),
    intensity,
  };
}

describe("localDayKey / countPostedToday", () => {
  const nowMs = Date.parse("2026-10-11T15:00:00");

  it("counts only same local calendar day", () => {
    const entries = [
      entry(1, 0, nowMs),
      entry(2, 1, nowMs),
      entry(30, 0, nowMs), // previous day
    ];
    const { help, promo, dayKey } = countPostedToday(entries, nowMs);
    assert.equal(dayKey, localDayKey(nowMs));
    assert.equal(help, 1);
    assert.equal(promo, 1);
  });
});

describe("evaluateCadence", () => {
  const nowMs = Date.parse("2026-10-11T15:00:00");

  it("reports remaining slots under budget", () => {
    const status = evaluateCadence({
      enabled: true,
      maxHelpPerDay: 5,
      maxPromoPerDay: 1,
      entries: [entry(1, 0, nowMs), entry(2, 0, nowMs)],
      nowMs,
    });
    assert.equal(status.helpPostedToday, 2);
    assert.equal(status.helpRemaining, 3);
    assert.equal(status.promoRemaining, 1);
    assert.equal(status.dayExhausted, false);
    assert.equal(cadenceBlocksIntensity(status, 0), false);
    assert.equal(cadenceBlocksIntensity(status, 1), false);
  });

  it("exhausts help when at max", () => {
    const entries = Array.from({ length: 5 }, () => entry(1, 0, nowMs));
    const status = evaluateCadence({
      enabled: true,
      maxHelpPerDay: 5,
      maxPromoPerDay: 1,
      entries,
      nowMs,
    });
    assert.equal(status.helpExhausted, true);
    assert.equal(status.promoExhausted, false);
    assert.equal(cadenceBlocksIntensity(status, 0), true);
    assert.equal(cadenceBlocksIntensity(status, 1), false);
  });

  it("exhausts the day when help and promo are spent", () => {
    const entries = [
      ...Array.from({ length: 5 }, () => entry(1, 0, nowMs)),
      entry(1, 1, nowMs),
    ];
    const status = evaluateCadence({
      enabled: true,
      maxHelpPerDay: 5,
      maxPromoPerDay: 1,
      entries,
      nowMs,
    });
    assert.equal(status.dayExhausted, true);
    assert.ok(formatCadenceLog(status).includes("EXHAUSTED"));
  });

  it("does not block when disabled", () => {
    const entries = Array.from({ length: 20 }, () => entry(1, 0, nowMs));
    const status = evaluateCadence({
      enabled: false,
      maxHelpPerDay: 5,
      maxPromoPerDay: 1,
      entries,
      nowMs,
    });
    assert.equal(status.dayExhausted, false);
    assert.equal(cadenceBlocksIntensity(status, 0), false);
  });
});

describe("trimOpportunitiesForCadence", () => {
  it("caps list to remaining help+promo slots", () => {
    const status = evaluateCadence({
      enabled: true,
      maxHelpPerDay: 2,
      maxPromoPerDay: 1,
      entries: [
        {
          postedAt: new Date().toISOString(),
          intensity: 0,
        },
      ],
    });
    // 1 help posted → remaining 1 help + 1 promo = 2
    const items = [1, 2, 3, 4];
    assert.deepEqual(trimOpportunitiesForCadence(items, status), [1, 2]);
  });

  it("returns empty when day exhausted", () => {
    const nowMs = Date.now();
    const status = evaluateCadence({
      enabled: true,
      maxHelpPerDay: 1,
      maxPromoPerDay: 0,
      entries: [{ postedAt: new Date(nowMs).toISOString(), intensity: 0 }],
      nowMs,
    });
    assert.deepEqual(trimOpportunitiesForCadence([1, 2], status), []);
  });
});
