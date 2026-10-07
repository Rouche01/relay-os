import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  AllowlistStore,
  compareScoutPriority,
  type AllowlistEntry,
} from "../src/allowlist-store.js";
import { ALLOWLISTED_SUBREDDITS } from "../src/reddit/config.js";

function entry(
  partial: Partial<AllowlistEntry> & Pick<AllowlistEntry, "name">
): AllowlistEntry {
  return {
    rulesOk: true,
    note: "",
    source: "seed",
    status: "postable",
    score: 10,
    approvedCount: 0,
    abortedCount: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

/** Seed rows already scouted so mergeSeed does not drown custom fixtures. */
function scoutedSeeds(at = "2026-10-07T10:00:00.000Z"): AllowlistEntry[] {
  return ALLOWLISTED_SUBREDDITS.map((p) =>
    entry({
      name: p.name,
      rulesOk: p.rulesOk,
      note: p.note,
      status: p.rulesOk ? "postable" : "rejected",
      score: p.rulesOk ? 10 : 0,
      lastScoutedAt: p.rulesOk ? at : undefined,
    })
  );
}

describe("compareScoutPriority", () => {
  it("prefers never-scouted over recently scouted even at lower score", () => {
    const never = entry({ name: "cold", score: 5 });
    const hot = entry({
      name: "hot",
      score: 99,
      lastScoutedAt: "2026-10-07T12:00:00.000Z",
    });
    assert.ok(compareScoutPriority(never, hot) < 0);
    assert.ok(compareScoutPriority(hot, never) > 0);
  });

  it("among never-scouted, prefers higher score", () => {
    const a = entry({ name: "a", score: 3 });
    const b = entry({ name: "b", score: 10 });
    assert.ok(compareScoutPriority(b, a) < 0);
  });

  it("among scouted, prefers older lastScoutedAt", () => {
    const older = entry({
      name: "older",
      score: 10,
      lastScoutedAt: "2026-09-01T00:00:00.000Z",
    });
    const newer = entry({
      name: "newer",
      score: 10,
      lastScoutedAt: "2026-10-01T00:00:00.000Z",
    });
    assert.ok(compareScoutPriority(older, newer) < 0);
  });
});

describe("AllowlistStore scout rotation", () => {
  it("pickScoutSubs rotates away from recently scouted high-score subs", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "allowlist-scout-"));
    const file = path.join(dir, "subreddits.json");
    await fs.writeFile(
      file,
      JSON.stringify({
        version: 1,
        entries: [
          ...scoutedSeeds(),
          entry({
            name: "alpha",
            source: "discovered",
            score: 50,
            lastScoutedAt: "2026-10-07T10:00:00.000Z",
          }),
          entry({
            name: "beta",
            source: "discovered",
            score: 40,
            lastScoutedAt: "2026-10-07T10:00:00.000Z",
          }),
          entry({ name: "gamma", source: "discovered", score: 5 }),
          entry({ name: "delta", source: "discovered", score: 4 }),
        ],
      }),
      "utf8"
    );

    const store = new AllowlistStore(file);
    const first = await store.pickScoutSubs(2, false);
    assert.deepEqual(first, ["gamma", "delta"]);

    await store.recordScouted(first);
    const second = await store.pickScoutSubs(2, false);
    // Seeds + alpha/beta share the same lastScoutedAt; higher score wins among them.
    assert.equal(second[0], "alpha");
    assert.equal(second[1], "beta");

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("prefer slot still forces a just-promoted sub into the pick", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "allowlist-prefer-"));
    const file = path.join(dir, "subreddits.json");
    await fs.writeFile(
      file,
      JSON.stringify({
        version: 1,
        entries: [
          ...scoutedSeeds(),
          entry({ name: "cold_a", source: "discovered", score: 1 }),
          entry({ name: "cold_b", source: "discovered", score: 1 }),
          entry({
            name: "fresh_promo",
            score: 20,
            source: "discovered",
            lastScoutedAt: "2026-10-07T11:00:00.000Z",
            updatedAt: "2026-10-07T12:00:00.000Z",
          }),
        ],
      }),
      "utf8"
    );

    const store = new AllowlistStore(file);
    const picked = await store.pickScoutSubs(2, true, {
      prefer: "fresh_promo",
    });
    assert.equal(picked.length, 2);
    assert.ok(picked.includes("fresh_promo"));
    assert.ok(picked.includes("cold_a") || picked.includes("cold_b"));

    await fs.rm(dir, { recursive: true, force: true });
  });
});
