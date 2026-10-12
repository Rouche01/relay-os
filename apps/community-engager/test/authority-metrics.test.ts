import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  evaluateAuthorityScore,
  formatAuthorityLog,
  resolveAuthorityScoreCard,
} from "../src/metrics/authority-metrics.js";

describe("evaluateAuthorityScore", () => {
  const nowMs = Date.parse("2026-10-12T12:00:00Z");

  it("computes health product when activations are zero", () => {
    const card = evaluateAuthorityScore({
      promoEntries: [
        { postedAt: "2026-10-10T12:00:00Z", intensity: 0 },
        { postedAt: "2026-10-10T13:00:00Z", intensity: 0 },
        { postedAt: "2026-10-10T14:00:00Z", intensity: 0 },
        { postedAt: "2026-10-10T15:00:00Z", intensity: 0 },
        { postedAt: "2026-10-10T16:00:00Z", intensity: 0 },
        { postedAt: "2026-10-10T17:00:00Z", intensity: 0 },
        { postedAt: "2026-10-10T18:00:00Z", intensity: 0 },
        { postedAt: "2026-10-10T19:00:00Z", intensity: 0 },
        { postedAt: "2026-10-10T20:00:00Z", intensity: 0 },
        { postedAt: "2026-10-11T12:00:00Z", intensity: 1 },
      ],
      visibilityResults: [
        {
          visibilityOk: true,
          status: "visible",
          checkedAt: "2026-10-11T12:00:00Z",
        },
        {
          visibilityOk: true,
          status: "visible",
          checkedAt: "2026-10-11T13:00:00Z",
        },
      ],
      watches: [
        { status: "replied" },
        { status: "replied" },
        { status: "expired" },
        { status: "removed" },
      ],
      attributionJobs: 3,
      attributedActivations: 0,
      nowMs,
    });
    assert.equal(card.promoRatio, 0.1);
    assert.equal(card.visibilityRate, 1);
    assert.equal(card.replyRate, 0.5);
    assert.equal(card.scoreWithActivations, 0);
    assert.ok(card.score > 0);
    assert.equal(card.constraints.promoOk, true);
    assert.match(formatAuthorityLog(card), /score=/);
  });

  it("multiplies activations into the glance score when present", () => {
    const card = evaluateAuthorityScore({
      promoEntries: [],
      visibilityResults: [
        {
          visibilityOk: true,
          status: "visible",
          checkedAt: "2026-10-11T12:00:00Z",
        },
      ],
      watches: [{ status: "replied" }],
      attributionJobs: 1,
      attributedActivations: 2,
      nowMs,
    });
    // vis=1, reply=1, promo=0 → health=1 → score=2
    assert.equal(card.score, 2);
    assert.equal(card.scoreWithActivations, 2);
  });
});

describe("resolveAuthorityScoreCard", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("reads ledgers from the data dir", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ce-auth-"));
    await mkdir(path.join(dir, "promo"), { recursive: true });
    await mkdir(path.join(dir, "visibility"), { recursive: true });
    await mkdir(path.join(dir, "post-watch"), { recursive: true });
    await mkdir(path.join(dir, "attribution"), { recursive: true });

    await writeFile(
      path.join(dir, "promo", "ledger.json"),
      JSON.stringify({
        entries: [
          { postedAt: new Date().toISOString(), intensity: 0 },
          { postedAt: new Date().toISOString(), intensity: 0 },
        ],
        updatedAt: new Date().toISOString(),
      }),
      "utf8"
    );
    await writeFile(
      path.join(dir, "visibility", "job_1.json"),
      JSON.stringify({
        status: "visible",
        visibilityOk: true,
        permalink: "https://reddit.com/x",
        checkedAt: new Date().toISOString(),
      }),
      "utf8"
    );
    await writeFile(
      path.join(dir, "post-watch", "queue.json"),
      JSON.stringify({
        watches: [
          {
            id: "w1",
            enrolledAt: new Date().toISOString(),
            checkAfter: new Date().toISOString(),
            expiresAt: new Date().toISOString(),
            subreddit: "fashion",
            threadUrl: "https://reddit.com/r/fashion/comments/1",
            threadTitle: "t",
            postedUrl: "https://reddit.com/r/fashion/comments/1/t/c",
            status: "replied",
          },
        ],
        updatedAt: new Date().toISOString(),
      }),
      "utf8"
    );
    await writeFile(
      path.join(dir, "attribution", "activations.json"),
      JSON.stringify({ count: 1, updatedAt: new Date().toISOString() }),
      "utf8"
    );

    const card = await resolveAuthorityScoreCard(dir);
    assert.equal(card.helpCount, 2);
    assert.equal(card.visibilityOk, 1);
    assert.equal(card.replied, 1);
    assert.equal(card.attributedActivations, 1);
    assert.ok(card.score > 0);
  });
});
