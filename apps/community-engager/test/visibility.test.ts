import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import type { FetchCommentResult } from "../src/reddit/write/comment-fetch.js";
import type { CommunityRuntimeConfig } from "../src/reddit/config.js";
import {
  checkCommentVisibility,
  classifyVisibilityFetch,
  formatVisibilityLog,
} from "../src/stages/execute/visibility.js";

function baseCfg(dataDir: string): CommunityRuntimeConfig {
  return {
    reddit: {
      userAgent: "test-agent",
      username: "gostylens_bot",
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
      enabled: false,
      firstCheckAfterHours: 1,
      minAgeHours: 1,
      maxAgeHours: 72,
      maxPerRun: 10,
      followUpIntensity: 0,
    },
    cadence: {
      enabled: false,
      maxHelpPerDay: 5,
      maxPromoPerDay: 1,
      scheduleEnabled: false,
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
      maxAgeHours: 6,
    },
    jobs: { maxJobs: 3, delayMs: 0 },
    product: { lpBaseUrl: "https://gostylens.app" },
  };
}

describe("classifyVisibilityFetch", () => {
  it("marks visible when comment is public", () => {
    const fetched: FetchCommentResult = {
      ok: true,
      status: 200,
      comment: {
        id: "abc",
        name: "t1_abc",
        author: "gostylens_bot",
        body: "helpful reply",
        permalink: "https://www.reddit.com/r/x/comments/1/t/abc/",
        removed: false,
        deleted: false,
        replies: [],
      },
    };
    const r = classifyVisibilityFetch(fetched, {
      expectedAuthor: "gostylens_bot",
    });
    assert.equal(r.status, "visible");
    assert.equal(r.visibilityOk, true);
  });

  it("marks removed when body is removed", () => {
    const fetched: FetchCommentResult = {
      ok: true,
      status: 200,
      comment: {
        id: "abc",
        name: "t1_abc",
        author: "[deleted]",
        body: "[removed]",
        permalink: "https://www.reddit.com/r/x/comments/1/t/abc/",
        removed: true,
        deleted: true,
        replies: [],
      },
    };
    const r = classifyVisibilityFetch(fetched);
    assert.equal(r.status, "removed");
    assert.equal(r.visibilityOk, false);
  });

  it("marks missing on 404", () => {
    const r = classifyVisibilityFetch({
      ok: false,
      status: 404,
      error: "not found (404)",
    });
    assert.equal(r.status, "missing");
    assert.equal(r.visibilityOk, false);
  });

  it("marks missing on author mismatch", () => {
    const fetched: FetchCommentResult = {
      ok: true,
      status: 200,
      comment: {
        id: "abc",
        name: "t1_abc",
        author: "someone_else",
        body: "ok",
        permalink: "https://www.reddit.com/r/x/comments/1/t/abc/",
        removed: false,
        deleted: false,
        replies: [],
      },
    };
    const r = classifyVisibilityFetch(fetched, {
      expectedAuthor: "gostylens_bot",
    });
    assert.equal(r.status, "missing");
    assert.equal(r.authorMismatch, true);
    assert.equal(r.visibilityOk, false);
  });
});

describe("checkCommentVisibility", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("persists a visible result and skips delay when delayMs=0", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ce-vis-"));
    const cfg = baseCfg(dir);
    const result = await checkCommentVisibility(
      "https://www.reddit.com/r/fashion/comments/abc/title/def/",
      {
        cfg,
        jobId: "job:test:1",
        delayMs: 0,
        fetchComment: async () => ({
          ok: true,
          status: 200,
          comment: {
            id: "def",
            name: "t1_def",
            author: "gostylens_bot",
            body: "hi",
            permalink:
              "https://www.reddit.com/r/fashion/comments/abc/title/def/",
            removed: false,
            deleted: false,
            replies: [],
          },
        }),
      }
    );
    assert.equal(result.status, "visible");
    assert.equal(result.visibilityOk, true);
    assert.ok(formatVisibilityLog(result).includes("OK"));
    const raw = await readFile(
      path.join(dir, "visibility", "job_test_1.json"),
      "utf8"
    );
    const saved = JSON.parse(raw) as { status: string };
    assert.equal(saved.status, "visible");
  });

  it("skips when disabled", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ce-vis-"));
    const cfg = baseCfg(dir);
    cfg.visibility.enabled = false;
    const result = await checkCommentVisibility(
      "https://www.reddit.com/r/x/comments/1/t/2/",
      { cfg, delayMs: 0 }
    );
    assert.equal(result.status, "skipped");
    assert.equal(result.visibilityOk, false);
  });
});
