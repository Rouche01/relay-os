import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { draftReply } from "../src/drafter.js";
import { parseWarmupMode } from "../src/reddit/config.js";
import type { CommunityDraft } from "../src/types.js";
import {
  accountDaysSince,
  evaluateWarmup,
  formatWarmupLog,
  readWarmupState,
  recordHelpCommentPosted,
  resolveEnvAccountSnapshot,
  writeWarmupState,
} from "../src/warmup.js";

function draft(overrides: Partial<CommunityDraft> = {}): CommunityDraft {
  return {
    id: "reddit-abc",
    platform: "reddit",
    subreddit: "femalefashionadvice",
    threadUrl: "https://www.reddit.com/r/femalefashionadvice/comments/abc",
    threadTitle: "Capsule help",
    opText: "Need a simple system.",
    draftText: "",
    intensity: 1,
    score: {
      problemFit: true,
      wantsHelp: true,
      rulesOk: true,
      freshnessOk: true,
      valueWithoutApp: true,
      competition: true,
      icpFit: true,
      plugNaturalness: true,
    },

    rationale: "help ask",
    status: "proposed",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("parseWarmupMode", () => {
  it("parses auto / force / off aliases", () => {
    assert.equal(parseWarmupMode("auto"), "auto");
    assert.equal(parseWarmupMode(undefined), "auto");
    assert.equal(parseWarmupMode("force"), "force");
    assert.equal(parseWarmupMode("true"), "force");
    assert.equal(parseWarmupMode("off"), "off");
    assert.equal(parseWarmupMode("false"), "off");
    assert.equal(parseWarmupMode("weird"), "auto");
  });
});

describe("evaluateWarmup", () => {
  const thresholds = {
    minAccountDays: 30,
    minKarma: 100,
    minHelpComments: 10,
  };

  it("is inactive when mode is off", () => {
    const status = evaluateWarmup({
      mode: "off",
      thresholds,
      helpCommentsPosted: 0,
      account: { source: "unknown" },
    });
    assert.equal(status.active, false);
    assert.deepEqual(status.reasons, []);
  });

  it("is always active when mode is force", () => {
    const status = evaluateWarmup({
      mode: "force",
      thresholds,
      helpCommentsPosted: 99,
      account: { createdUtc: 1_000_000_000, totalKarma: 9999, source: "env" },
    });
    assert.equal(status.active, true);
    assert.match(status.reasons[0] ?? "", /force/);
  });

  it("stays active in auto until help-comment threshold is met", () => {
    const status = evaluateWarmup({
      mode: "auto",
      thresholds,
      helpCommentsPosted: 3,
      account: { source: "unknown" },
    });
    assert.equal(status.active, true);
    assert.ok(status.reasons.some((r) => /help comments/.test(r)));
  });

  it("uses account age and karma when known", () => {
    const nowMs = Date.parse("2026-10-11T00:00:00Z");
    const createdUtc = Math.floor(
      (nowMs - 10 * 24 * 60 * 60 * 1000) / 1000
    );
    const status = evaluateWarmup({
      mode: "auto",
      thresholds,
      helpCommentsPosted: 20,
      account: { createdUtc, totalKarma: 40, source: "env" },
      nowMs,
    });
    assert.equal(status.active, true);
    assert.ok(status.reasons.some((r) => /account age/.test(r)));
    assert.ok(status.reasons.some((r) => /karma/.test(r)));
    assert.equal(status.accountDays, 10);
  });

  it("exits auto when all known thresholds are met", () => {
    const nowMs = Date.parse("2026-10-11T00:00:00Z");
    const createdUtc = Math.floor(
      (nowMs - 45 * 24 * 60 * 60 * 1000) / 1000
    );
    const status = evaluateWarmup({
      mode: "auto",
      thresholds,
      helpCommentsPosted: 12,
      account: { createdUtc, totalKarma: 150, source: "oauth" },
      nowMs,
    });
    assert.equal(status.active, false);
    assert.deepEqual(status.reasons, []);
  });
});

describe("accountDaysSince + env snapshot", () => {
  it("computes whole days", () => {
    const nowMs = Date.parse("2026-01-31T12:00:00Z");
    const createdUtc = Math.floor(Date.parse("2026-01-01T12:00:00Z") / 1000);
    assert.equal(accountDaysSince(createdUtc, nowMs), 30);
  });

  it("parses COMMUNITY_WARMUP_ACCOUNT_CREATED_AT + KARMA", () => {
    const snap = resolveEnvAccountSnapshot({
      COMMUNITY_WARMUP_ACCOUNT_CREATED_AT: "2025-01-01T00:00:00Z",
      COMMUNITY_WARMUP_KARMA: "250",
    } as NodeJS.ProcessEnv);
    assert.ok(snap);
    assert.equal(snap.source, "env");
    assert.equal(snap.totalKarma, 250);
    assert.equal(
      snap.createdUtc,
      Math.floor(Date.parse("2025-01-01T00:00:00Z") / 1000)
    );
  });
});

describe("warmup state file", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("records help comments", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "warmup-"));
    await writeWarmupState(dir, {
      helpCommentsPosted: 0,
      updatedAt: new Date(0).toISOString(),
    });
    const n1 = await recordHelpCommentPosted(dir);
    const n2 = await recordHelpCommentPosted(dir);
    assert.equal(n1, 1);
    assert.equal(n2, 2);
    const state = await readWarmupState(dir);
    assert.equal(state.helpCommentsPosted, 2);
  });
});

describe("draftReply warmup", () => {
  const savedKey = process.env.GEMINI_API_KEY;

  afterEach(() => {
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedKey;
  });

  it("forces intensity 0 and strips GoStylens when warmup is active", async () => {
    delete process.env.GEMINI_API_KEY;
    const outcome = await draftReply(draft({ intensity: 1 }), {
      text: "Try a capsule. GoStylens can help track gaps.",
      intensity: 1,
      warmupActive: true,
    });
    assert.equal(outcome.draft.intensity, 0);
    assert.doesNotMatch(outcome.draft.draftText, /GoStylens/i);
  });
});

describe("formatWarmupLog", () => {
  it("mentions ACTIVE when warming", () => {
    const log = formatWarmupLog({
      active: true,
      mode: "auto",
      reasons: ["help comments 0 < 10"],
      thresholds: {
        minAccountDays: 30,
        minKarma: 100,
        minHelpComments: 10,
      },
      helpCommentsPosted: 0,
      accountStatsUnknown: true,
    });
    assert.match(log, /ACTIVE/);
    assert.match(log, /help comments/);
  });
});
