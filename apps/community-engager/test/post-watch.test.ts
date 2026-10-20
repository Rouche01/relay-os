import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  commentIdFromPermalink,
  fetchRedditComment,
  permalinkToJsonUrl,
  type FetchCommentResult,
} from "../src/reddit/write/comment-fetch.js";
import {
  buildFollowUpDraft,
  enrollPostWatch,
  prioritizeDueWatches,
  processDuePostWatches,
  readPostWatchQueue,
} from "../src/stages/post-watch/post-watch.js";
import type { CommunityRuntimeConfig } from "../src/reddit/config.js";
import type { PostWatchEntry } from "../src/stages/post-watch/post-watch.js";

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
    redditApis: {
      baseUrl: "https://api.redditapis.com",
      configured: false,
    },
    postMode: "auto",
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
      firstCheckAfterHours: 1,
      minAgeHours: 1,
      maxAgeHours: 72,
      maxPerRun: 10,
      followUpIntensity: 0,
    },
    cadence: {
      enabled: true,
      maxHelpPerDay: 5,
      maxPromoPerDay: 1,
      scheduleEnabled: true,
      scheduleCron: "0 9,13,18 * * *",
      maxJobsPerRun: 2,
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
      onEmptyScout: "off",
      onEmptyScoutMax: 1,
      onEmptyScoutMaxPerDay: 3,
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

describe("fetchRedditComment via redditapis", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("uses Bearer comment-by-id when redditApis is configured", async () => {
    let seenUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = String(input);
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        "Bearer test-key"
      );
      return new Response(
        JSON.stringify({
          comment: {
            kind: "t1",
            data: {
              id: "phxxrt8",
              name: "t1_phxxrt8",
              body: "still up",
              author: "me",
              permalink: "/r/test/comments/abc/title/phxxrt8/",
              replies: {
                data: {
                  children: [
                    {
                      kind: "t1",
                      data: {
                        id: "reply1",
                        author: "other",
                        body: "nice tip",
                      },
                    },
                  ],
                },
              },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const result = await fetchRedditComment(
      "https://www.reddit.com/r/test/comments/abc/title/phxxrt8/",
      {
        redditApis: {
          apiKey: "test-key",
          baseUrl: "https://api.redditapis.com",
          configured: true,
        },
      }
    );

    assert.equal(
      seenUrl,
      "https://api.redditapis.com/api/reddit/comment/phxxrt8"
    );
    assert.equal(result.ok, true);
    assert.equal(result.source, "redditapis");
    assert.equal(result.comment?.body, "still up");
    assert.equal(result.comment?.replies.length, 1);
    assert.equal(result.comment?.replies[0]?.body, "nice tip");
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

  it("enrolls a watch with first look at 1h and expires at maxAge", async () => {
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
      firstCheckAfterHours: 1,
      maxAgeHours: 72,
      nowMs,
    });

    assert.equal(entry.status, "pending");
    assert.equal(entry.commentId, "t1_xyz");
    assert.equal(entry.checkAfter, "2026-10-11T13:00:00.000Z");
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
      firstCheckAfterHours: 1,
      maxAgeHours: 72,
      nowMs: enrollMs,
    });

    const nowMs = Date.parse("2026-10-10T13:30:00Z"); // past first look (+1h)
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
    assert.ok(result.outcomeHints.some((h) => h.tag === "got_reply"));

    const queue = await readPostWatchQueue(dir);
    assert.equal(queue.watches[0]!.status, "replied");
    assert.equal(queue.watches[0]!.replyCount, 1);

    assert.ok(result.sweep);
    assert.equal(result.sweep!.success, true);
    assert.equal(result.sweep!.candidateCount, 1);
    assert.equal(result.sweep!.candidates[0]!.outcome, "replied");
    assert.equal(result.sweep!.candidates[0]!.phase, "first_look");
    assert.equal(result.sweep!.candidates[0]!.fetchOk, true);
    assert.ok(result.sweepPath);
    const { readFile } = await import("node:fs/promises");
    const onDisk = JSON.parse(await readFile(result.sweepPath!, "utf8")) as {
      sweepId: string;
      candidates: unknown[];
    };
    assert.equal(onDisk.sweepId, result.sweep!.sweepId);
    assert.equal(onDisk.candidates.length, 1);
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
      firstCheckAfterHours: 1,
      maxAgeHours: 72,
      nowMs: enrollMs,
    });

    const result = await processDuePostWatches(baseCfg(dir), {
      nowMs: Date.parse("2026-10-10T13:30:00Z"),
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

    assert.ok(result.outcomeHints.some((h) => h.tag === "removed"));

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

  it("does not check before first look (checkAfter)", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ce-postwatch-"));
    const enrollMs = Date.parse("2026-10-11T12:00:00Z");
    await enrollPostWatch(dir, {
      postedUrl:
        "https://www.reddit.com/r/fashion/comments/abc/title/xyz/",
      subreddit: "fashion",
      threadUrl: "https://www.reddit.com/r/fashion/comments/abc/title/",
      threadTitle: "Need outfit help",
      firstCheckAfterHours: 1,
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

  it("prioritizes first_look over sustained when capped", () => {
    const due: PostWatchEntry[] = [
      {
        id: "sustained",
        enrolledAt: "2026-10-10T10:00:00.000Z",
        checkAfter: "2026-10-10T11:00:00.000Z",
        expiresAt: "2026-10-13T10:00:00.000Z",
        subreddit: "fashion",
        threadUrl: "https://reddit.com/r/a",
        threadTitle: "a",
        postedUrl: "https://reddit.com/r/a/c1/",
        status: "pending",
        lastCheckedAt: "2026-10-10T12:00:00.000Z",
      },
      {
        id: "first",
        enrolledAt: "2026-10-10T12:00:00.000Z",
        checkAfter: "2026-10-10T13:00:00.000Z",
        expiresAt: "2026-10-13T12:00:00.000Z",
        subreddit: "fashion",
        threadUrl: "https://reddit.com/r/b",
        threadTitle: "b",
        postedUrl: "https://reddit.com/r/b/c2/",
        status: "pending",
      },
    ];
    const picked = prioritizeDueWatches(due, 1);
    assert.equal(picked.length, 1);
    assert.equal(picked[0]!.id, "first");
  });

  it("tags sustained on the second poll", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ce-postwatch-"));
    const enrollMs = Date.parse("2026-10-10T12:00:00Z");
    await enrollPostWatch(dir, {
      postedUrl:
        "https://www.reddit.com/r/fashion/comments/abc/title/xyz/",
      subreddit: "fashion",
      threadUrl: "https://www.reddit.com/r/fashion/comments/abc/title/",
      threadTitle: "Need outfit help",
      firstCheckAfterHours: 1,
      maxAgeHours: 72,
      nowMs: enrollMs,
    });

    const quietFetch = async (): Promise<FetchCommentResult> => ({
      ok: true,
      status: 200,
      comment: {
        id: "xyz",
        name: "t1_xyz",
        author: "us",
        body: "Help text",
        permalink:
          "https://www.reddit.com/r/fashion/comments/abc/title/xyz/",
        removed: false,
        deleted: false,
        replies: [],
      },
    });

    const first = await processDuePostWatches(baseCfg(dir), {
      nowMs: Date.parse("2026-10-10T13:30:00Z"),
      fetchComment: quietFetch,
    });
    assert.equal(first.sweep!.candidates[0]!.phase, "first_look");
    assert.equal(first.sweep!.candidates[0]!.outcome, "pending");

    const second = await processDuePostWatches(baseCfg(dir), {
      nowMs: Date.parse("2026-10-10T14:30:00Z"),
      fetchComment: quietFetch,
    });
    assert.equal(second.sweep!.candidates[0]!.phase, "sustained");
    assert.equal(second.sweep!.candidates[0]!.outcome, "pending");
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
