import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  commentIdFromPermalink,
  permalinkToJsonUrl,
  type FetchCommentResult,
} from "../src/reddit/comment-fetch.js";
import {
  buildFollowUpDraft,
  enrollPostWatch,
  processDuePostWatches,
  readPostWatchQueue,
} from "../src/post-watch.js";
import type { CommunityRuntimeConfig } from "../src/reddit/config.js";
import type { PostWatchEntry } from "../src/post-watch.js";

function baseCfg(dataDir: string): CommunityRuntimeConfig {
  return {
    reddit: {
      userAgent: "test-agent",
      oauthConfigured: false,
      configured: false,
      hasUserPass: false,
      dryRun: true,
      transport: "fixtures",
      browserHeadless: true,
      interstitialHitl: false,
      dataDir,
      cookieDir: path.join(dataDir, "cookies"),
    },
    warmup: {
      mode: "off",
      minAccountDays: 30,
      minKarma: 100,
      minHelpComments: 10,
    },
    promo: {
      enabled: false,
      maxRatio: 0.1,
      windowDays: 30,
      onExceed: "block",
    },
    postWatch: {
      enabled: true,
      minAgeHours: 24,
      maxAgeHours: 72,
      maxPerRun: 10,
      followUpIntensity: 0,
    },
    cadence: {
      enabled: true,
      maxHelpPerDay: 5,
      maxPromoPerDay: 1,
    },
    visibility: {
      enabled: true,
      delayMs: 0,
    },
    discover: {
      mode: "off",
      enabled: false,
      query: "",
      maxCandidates: 5,
      minPostable: 1,
      exploreSlot: false,
      goal: "",
      requeueDays: 14,
    },
    scout: {
      source: "fixtures",
      delayMs: 0,
      delayJitterMs: 0,
      maxSubs: 0,
      scrollRounds: 1,
      deepReadMax: 1,
      subBudgetMs: 3000,
    },
    jobs: { maxJobs: 3, delayMs: 0 },
    product: { lpBaseUrl: "https://gostylens.app" },
  };
}

describe("comment-fetch helpers", () => {
  it("builds .json URL from permalink", () => {
    const url = permalinkToJsonUrl(
      "https://www.reddit.com/r/fashion/comments/abc123/title/def456/"
    );
    assert.equal(
      url,
      "https://www.reddit.com/r/fashion/comments/abc123/title/def456.json?raw_json=1"
    );
  });

  it("extracts comment id from permalink", () => {
    assert.equal(
      commentIdFromPermalink(
        "https://www.reddit.com/r/fashion/comments/abc123/title/def456/"
      ),
      "t1_def456"
    );
  });
});

describe("post-watch enroll + process", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("enrolls a watch with checkAfter/expiresAt from min/max age", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ce-postwatch-"));
    const nowMs = Date.parse("2026-10-11T12:00:00Z");
    const entry = await enrollPostWatch(dir, {
      postedUrl:
        "https://www.reddit.com/r/fashion/comments/abc/title/xyz/",
      subreddit: "fashion",
      threadUrl: "https://www.reddit.com/r/fashion/comments/abc/title/",
      threadTitle: "Need outfit help",
      draftId: "draft-1",
      jobId: "job-1",
      minAgeHours: 24,
      maxAgeHours: 72,
      nowMs,
    });

    assert.equal(entry.status, "pending");
    assert.equal(entry.commentId, "t1_xyz");
    assert.equal(entry.checkAfter, "2026-10-12T12:00:00.000Z");
    assert.equal(entry.expiresAt, "2026-10-14T12:00:00.000Z");

    const queue = await readPostWatchQueue(dir);
    assert.equal(queue.watches.length, 1);
    assert.equal(queue.watches[0]!.id, entry.id);
  });

  it("queues a follow-up when replies appear after checkAfter", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ce-postwatch-"));
    const enrollMs = Date.parse("2026-10-10T12:00:00Z");
    await enrollPostWatch(dir, {
      postedUrl:
        "https://www.reddit.com/r/fashion/comments/abc/title/xyz/",
      subreddit: "fashion",
      threadUrl: "https://www.reddit.com/r/fashion/comments/abc/title/",
      threadTitle: "Need outfit help",
      minAgeHours: 24,
      maxAgeHours: 72,
      nowMs: enrollMs,
    });

    const nowMs = Date.parse("2026-10-11T14:00:00Z"); // past checkAfter
    const fetchComment = async (): Promise<FetchCommentResult> => ({
      ok: true,
      status: 200,
      comment: {
        id: "xyz",
        name: "t1_xyz",
        author: "us",
        body: "Try a tonal knit first.",
        permalink:
          "https://www.reddit.com/r/fashion/comments/abc/title/xyz/",
        removed: false,
        deleted: false,
        replies: [
          {
            author: "op_user",
            body: "Thanks — what about shoes?",
            id: "reply1",
          },
        ],
      },
    });

    const result = await processDuePostWatches(baseCfg(dir), {
      nowMs,
      fetchComment,
    });

    assert.equal(result.checked, 1);
    assert.equal(result.replied, 1);
    assert.equal(result.followUps.length, 1);
    assert.equal(result.followUps[0]!.intensity, 0);
    assert.match(result.followUps[0]!.opText ?? "", /what about shoes/);
    assert.match(result.followUps[0]!.threadTitle, /^Re:/);

    const queue = await readPostWatchQueue(dir);
    assert.equal(queue.watches[0]!.status, "replied");
    assert.equal(queue.watches[0]!.replyCount, 1);
  });

  it("marks removed when comment is gone", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ce-postwatch-"));
    const enrollMs = Date.parse("2026-10-10T12:00:00Z");
    await enrollPostWatch(dir, {
      postedUrl:
        "https://www.reddit.com/r/fashion/comments/abc/title/xyz/",
      subreddit: "fashion",
      threadUrl: "https://www.reddit.com/r/fashion/comments/abc/title/",
      threadTitle: "Need outfit help",
      minAgeHours: 24,
      maxAgeHours: 72,
      nowMs: enrollMs,
    });

    const result = await processDuePostWatches(baseCfg(dir), {
      nowMs: Date.parse("2026-10-11T14:00:00Z"),
      fetchComment: async () => ({
        ok: true,
        status: 200,
        comment: {
          id: "xyz",
          name: "t1_xyz",
          author: "[deleted]",
          body: "[removed]",
          permalink:
            "https://www.reddit.com/r/fashion/comments/abc/title/xyz/",
          removed: true,
          deleted: true,
          replies: [],
        },
      }),
    });

    assert.equal(result.removed, 1);
    assert.equal(result.followUps.length, 0);
    const queue = await readPostWatchQueue(dir);
    assert.equal(queue.watches[0]!.status, "removed");
  });

  it("skips when disabled", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ce-postwatch-"));
    const cfg = baseCfg(dir);
    cfg.postWatch.enabled = false;
    const result = await processDuePostWatches(cfg, {
      nowMs: Date.now(),
      fetchComment: async () => {
        throw new Error("should not fetch");
      },
    });
    assert.equal(result.checked, 0);
  });

  it("does not check before checkAfter", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ce-postwatch-"));
    const enrollMs = Date.parse("2026-10-11T12:00:00Z");
    await enrollPostWatch(dir, {
      postedUrl:
        "https://www.reddit.com/r/fashion/comments/abc/title/xyz/",
      subreddit: "fashion",
      threadUrl: "https://www.reddit.com/r/fashion/comments/abc/title/",
      threadTitle: "Need outfit help",
      minAgeHours: 24,
      maxAgeHours: 72,
      nowMs: enrollMs,
    });

    let fetched = false;
    const result = await processDuePostWatches(baseCfg(dir), {
      nowMs: enrollMs + 60_000,
      fetchComment: async () => {
        fetched = true;
        return { ok: false, error: "unexpected" };
      },
    });
    assert.equal(result.checked, 0);
    assert.equal(fetched, false);
  });

  it("buildFollowUpDraft embeds reply context", () => {
    const watch: PostWatchEntry = {
      id: "watch-1",
      enrolledAt: "2026-10-10T12:00:00.000Z",
      checkAfter: "2026-10-11T12:00:00.000Z",
      expiresAt: "2026-10-13T12:00:00.000Z",
      subreddit: "fashion",
      threadUrl: "https://reddit.com/r/fashion/comments/abc/title/",
      threadTitle: "Need outfit help",
      postedUrl: "https://reddit.com/r/fashion/comments/abc/title/xyz/",
      status: "pending",
    };
    const draft = buildFollowUpDraft(
      watch,
      "Try navy first.",
      [{ author: "op", body: "What about shoes?", id: "r1" }],
      { intensity: 0, nowMs: Date.parse("2026-10-11T14:00:00Z") }
    );
    assert.equal(draft.id, "followup-watch-1");
    assert.equal(draft.status, "proposed");
    assert.match(draft.opText ?? "", /Try navy first/);
    assert.match(draft.opText ?? "", /What about shoes/);
  });
});
