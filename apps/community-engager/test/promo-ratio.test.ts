import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { draftReply } from "../src/stages/draft/drafter.js";
import {
  evaluatePromoRatio,
  formatPromoRatioLog,
  pruneEntries,
  readPromoLedger,
  recordPromoLedgerPost,
  type PromoLedgerEntry,
} from "../src/policy/promo-ratio.js";
import type { CommunityDraft } from "../src/types.js";

function entry(
  daysAgo: number,
  intensity: 0 | 1 | 2,
  nowMs: number
): PromoLedgerEntry {
  return {
    postedAt: new Date(nowMs - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    intensity,
  };
}

describe("evaluatePromoRatio", () => {
  const nowMs = Date.parse("2026-10-11T12:00:00Z");

  it("allows the 10th post to be promo when 9 were help (exactly 10%)", () => {
    const entries = Array.from({ length: 9 }, () => entry(1, 0, nowMs));
    const status = evaluatePromoRatio({
      enabled: true,
      maxRatio: 0.1,
      windowDays: 30,
      onExceed: "block",
      entries,
      proposedIntensity: 1,
      nowMs,
    });
    assert.equal(status.exceeds, false);
    assert.equal(status.blockPromo, false);
    assert.equal(status.projectedRatio, 0.1);
  });

  it("blocks a second promo when it would exceed 10%", () => {
    const entries = [
      ...Array.from({ length: 9 }, () => entry(1, 0, nowMs)),
      entry(1, 1, nowMs),
    ];
    const status = evaluatePromoRatio({
      enabled: true,
      maxRatio: 0.1,
      windowDays: 30,
      onExceed: "block",
      entries,
      proposedIntensity: 1,
      nowMs,
    });
    assert.equal(status.exceeds, true);
    assert.equal(status.blockPromo, true);
    assert.equal(status.warnPromo, false);
    assert.ok(status.reasons.length > 0);
  });

  it("warns instead of blocking when onExceed is warn", () => {
    const entries = [entry(1, 1, nowMs)];
    const status = evaluatePromoRatio({
      enabled: true,
      maxRatio: 0.1,
      windowDays: 30,
      onExceed: "warn",
      entries,
      proposedIntensity: 1,
      nowMs,
    });
    assert.equal(status.exceeds, true);
    assert.equal(status.blockPromo, false);
    assert.equal(status.warnPromo, true);
  });

  it("never exceeds when disabled", () => {
    const status = evaluatePromoRatio({
      enabled: false,
      maxRatio: 0.1,
      windowDays: 30,
      onExceed: "block",
      entries: [entry(0, 1, nowMs)],
      proposedIntensity: 1,
      nowMs,
    });
    assert.equal(status.exceeds, false);
    assert.equal(status.blockPromo, false);
  });

  it("help-only proposals never exceed", () => {
    const status = evaluatePromoRatio({
      enabled: true,
      maxRatio: 0.1,
      windowDays: 30,
      onExceed: "block",
      entries: [entry(0, 1, nowMs), entry(0, 1, nowMs)],
      proposedIntensity: 0,
      nowMs,
    });
    assert.equal(status.exceeds, false);
  });
});

describe("pruneEntries", () => {
  it("drops entries outside the window", () => {
    const nowMs = Date.parse("2026-10-11T00:00:00Z");
    const kept = pruneEntries(
      [entry(40, 0, nowMs), entry(5, 1, nowMs)],
      30,
      nowMs
    );
    assert.equal(kept.length, 1);
    assert.equal(kept[0]?.intensity, 1);
  });
});

describe("promo ledger file", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("records and prunes", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "promo-"));
    const nowMs = Date.parse("2026-10-11T00:00:00Z");
    await recordPromoLedgerPost(dir, {
      intensity: 0,
      windowDays: 30,
      postedAt: new Date(nowMs - 40 * 24 * 60 * 60 * 1000).toISOString(),
      nowMs,
    });
    await recordPromoLedgerPost(dir, {
      intensity: 1,
      jobId: "job-1",
      windowDays: 30,
      postedAt: new Date(nowMs).toISOString(),
      nowMs,
    });
    const state = await readPromoLedger(dir);
    assert.equal(state.entries.length, 1);
    assert.equal(state.entries[0]?.intensity, 1);
    assert.equal(state.entries[0]?.jobId, "job-1");
  });
});

describe("draftReply promo block", () => {
  const savedKey = process.env.GEMINI_API_KEY;

  afterEach(() => {
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedKey;
  });

  it("forces intensity 0 when forceIntensity0 is set", async () => {
    delete process.env.GEMINI_API_KEY;
    const draft: CommunityDraft = {
      id: "reddit-x",
      platform: "reddit",
      subreddit: "fashion",
      threadUrl: "https://reddit.com/r/fashion/comments/x",
      threadTitle: "Capsule",
      draftText: "",
      intensity: 1,
      score: {
        problemFit: true,
        competition: true,
        icpFit: true,
        plugNaturalness: true,
        wantsHelp: true,
        rulesOk: true,
        freshnessOk: true,
        valueWithoutApp: true,
      },
      rationale: "fit",
      status: "proposed",
      createdAt: new Date().toISOString(),
    };
    const outcome = await draftReply(draft, {
      text: "Try a capsule. GoStylens can help.",
      intensity: 1,
      forceIntensity0: true,
    });
    assert.equal(outcome.draft.intensity, 0);
    assert.doesNotMatch(outcome.draft.draftText, /GoStylens/i);
  });
});

describe("formatPromoRatioLog", () => {
  it("mentions EXCEEDS when over ratio", () => {
    const log = formatPromoRatioLog({
      enabled: true,
      exceeds: true,
      blockPromo: true,
      warnPromo: false,
      onExceed: "block",
      maxRatio: 0.1,
      windowDays: 30,
      helpCount: 1,
      promoCount: 1,
      currentRatio: 0.5,
      projectedRatio: 0.66,
      reasons: ["too promo"],
    });
    assert.match(log, /EXCEEDS/);
    assert.match(log, /block/);
  });
});
