import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { createPostWatchCollection } from "../src/admin/post-watch-collection.js";
import {
  persistPostWatchSweep,
  writePostWatchQueue,
  type PostWatchSweepLog,
} from "../src/stages/post-watch/post-watch.js";

describe("post-watch admin collection", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("lists queue watches with score columns", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ce-pw-admin-"));
    await writePostWatchQueue(dir, {
      updatedAt: "2026-10-20T21:00:00.000Z",
      watches: [
        {
          id: "watch-a",
          enrolledAt: "2026-10-20T12:00:00.000Z",
          checkAfter: "2026-10-20T13:00:00.000Z",
          expiresAt: "2026-10-23T12:00:00.000Z",
          subreddit: "capsulewardrobe",
          threadUrl: "https://www.reddit.com/r/capsulewardrobe/comments/1xazz5s/",
          threadTitle: "Long flight packing",
          postedUrl:
            "https://www.reddit.com/r/capsulewardrobe/comments/1xazz5s/comment/phxxrt8",
          status: "pending",
          lastCheckedAt: "2026-10-20T21:00:00.000Z",
          replyCount: 0,
          lastScore: 2,
          lastFetchSource: "redditapis",
        },
      ],
    });

    const col = createPostWatchCollection({ driver: "file", path: dir });
    const list = await col.list();
    assert.equal(list.rows.length, 1);
    assert.equal(list.rows[0]!.id, "watch-a");
    assert.equal(list.rows[0]!.score, "2");
    assert.equal(list.rows[0]!.status, "pending");
    assert.equal(list.rows[0]!.phase, "sustained");
  });

  it("get watch returns history from sweeps", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ce-pw-admin-"));
    await writePostWatchQueue(dir, {
      updatedAt: "2026-10-20T21:00:00.000Z",
      watches: [
        {
          id: "watch-a",
          enrolledAt: "2026-10-20T12:00:00.000Z",
          checkAfter: "2026-10-20T13:00:00.000Z",
          expiresAt: "2026-10-23T12:00:00.000Z",
          subreddit: "capsulewardrobe",
          threadUrl: "https://www.reddit.com/r/capsulewardrobe/comments/1xazz5s/",
          threadTitle: "Long flight packing",
          postedUrl:
            "https://www.reddit.com/r/capsulewardrobe/comments/1xazz5s/comment/phxxrt8",
          status: "pending",
          lastCheckedAt: "2026-10-20T21:00:00.000Z",
          lastScore: 3,
          replyCount: 0,
          lastFetchSource: "redditapis",
        },
      ],
    });

    const sweep1: PostWatchSweepLog = {
      schemaVersion: 1,
      sweepId: "sweep-one",
      startedAt: "2026-10-20T20:00:00.000Z",
      endedAt: "2026-10-20T20:00:01.000Z",
      source: "queue",
      candidateCount: 1,
      checked: 1,
      replied: 0,
      removed: 0,
      expired: 0,
      errors: 0,
      pending: 1,
      success: true,
      candidates: [
        {
          watchId: "watch-a",
          subreddit: "capsulewardrobe",
          postedUrl: "https://example.com/c",
          phase: "first_look",
          outcome: "pending",
          fetchOk: true,
          httpStatus: 200,
          replyCount: 0,
          score: 1,
          removed: false,
          deleted: false,
          fetchSource: "redditapis",
        },
      ],
    };
    const sweep2: PostWatchSweepLog = {
      ...sweep1,
      sweepId: "sweep-two",
      startedAt: "2026-10-20T21:00:00.000Z",
      endedAt: "2026-10-20T21:00:01.000Z",
      candidates: [
        {
          ...sweep1.candidates[0]!,
          phase: "sustained",
          score: 3,
        },
      ],
    };
    await persistPostWatchSweep(dir, sweep1);
    await persistPostWatchSweep(dir, sweep2);

    const col = createPostWatchCollection({ driver: "file", path: dir });
    const got = await col.get("watch-a");
    assert.ok(got);
    assert.equal(got!.detail?.kind, "post-watch-watch");
    const viz = got!.detail?.viz as {
      history: Array<{ score?: number; phase: string; sweepId: string }>;
      lastScore?: number;
    };
    assert.equal(viz.lastScore, 3);
    assert.equal(viz.history.length, 2);
    assert.equal(viz.history[0]!.score, 1);
    assert.equal(viz.history[0]!.phase, "first_look");
    assert.equal(viz.history[1]!.score, 3);
    assert.equal(viz.history[1]!.sweepId, "sweep-two");

    const series = await col.series!({ watchId: "watch-a" });
    assert.equal(series.points.length, 2);
    assert.equal(series.points[1]!.score, 3);
  });

  it("lists sweeps when status=sweeps", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ce-pw-admin-"));
    await mkdir(path.join(dir, "post-watch", "sweeps"), { recursive: true });
    const sweep: PostWatchSweepLog = {
      schemaVersion: 1,
      sweepId: "sweep-xyz",
      startedAt: "2026-10-20T21:00:00.000Z",
      endedAt: "2026-10-20T21:00:01.000Z",
      source: "queue",
      candidateCount: 1,
      checked: 1,
      replied: 0,
      removed: 0,
      expired: 0,
      errors: 0,
      pending: 1,
      success: true,
      candidates: [],
    };
    await persistPostWatchSweep(dir, sweep);

    const col = createPostWatchCollection({ driver: "file", path: dir });
    const list = await col.list({ status: "sweeps" });
    assert.equal(list.rows.length, 1);
    assert.equal(list.rows[0]!.id, "sweep:sweep-xyz");
    assert.equal(list.rows[0]!.success, "ok");

    const got = await col.get("sweep:sweep-xyz");
    assert.ok(got);
    assert.equal((got!.record as PostWatchSweepLog).sweepId, "sweep-xyz");
  });
});
