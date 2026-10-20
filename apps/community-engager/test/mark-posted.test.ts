import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { FileJsonActionStore } from "@relay/action-store";
import {
  markActionPostedAndWatch,
  normalizeCommentPermalink,
} from "../src/admin/mark-posted.js";
import { readPostWatchQueue } from "../src/stages/post-watch/post-watch.js";

describe("normalizeCommentPermalink", () => {
  it("accepts https comment links", () => {
    const u = normalizeCommentPermalink(
      "https://www.reddit.com/r/capsulewardrobe/comments/1xazz5s/title/abc123/"
    );
    assert.match(u, /reddit\.com\/r\/capsulewardrobe/);
    assert.doesNotMatch(u, /\/$/);
  });

  it("rejects empty", () => {
    assert.throws(() => normalizeCommentPermalink("  "), /required/);
  });
});

describe("markActionPostedAndWatch", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("sets posted + enrolls first-look watch", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ce-mark-posted-"));
    const storePath = path.join(dir, "actions.json");
    const store = new FileJsonActionStore({ filePath: storePath });
    await store.put({
      id: "reddit-1xazz5s",
      appId: "community-engager",
      status: "approved",
      createdAt: "2026-10-20T20:00:00.000Z",
      updatedAt: "2026-10-20T20:00:00.000Z",
      payload: {
        id: "reddit-1xazz5s",
        subreddit: "capsulewardrobe",
        threadUrl:
          "https://www.reddit.com/r/capsulewardrobe/comments/1xazz5s/best_trousers/",
        threadTitle: "Best trousers for flying",
        draftText: "Try M&S jersey…",
        status: "approved",
      },
    });

    const nowMs = Date.parse("2026-10-20T21:00:00.000Z");
    const result = await markActionPostedAndWatch(store, "reddit-1xazz5s", {
      postedUrl:
        "https://www.reddit.com/r/capsulewardrobe/comments/1xazz5s/best_trousers/xyz789/",
      dataDir: dir,
      nowMs,
    });

    assert.equal(result.record.status, "posted");
    assert.equal(result.alreadyPosted, false);
    assert.equal(result.checkAfter, "2026-10-20T22:00:00.000Z");
    assert.ok(result.watchId.startsWith("watch-"));

    const again = await store.get("reddit-1xazz5s");
    const payload = again!.payload as Record<string, unknown>;
    assert.equal(payload.status, "posted");
    assert.match(String(payload.postedUrl), /xyz789/);
    assert.equal(payload.postMode, "manual");

    const queue = await readPostWatchQueue(dir);
    assert.equal(queue.watches.length, 1);
    assert.equal(queue.watches[0]!.draftId, "reddit-1xazz5s");
    assert.equal(queue.watches[0]!.subreddit, "capsulewardrobe");
  });
});
