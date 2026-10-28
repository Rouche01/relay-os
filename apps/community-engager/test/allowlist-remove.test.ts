import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createAllowlistCollection } from "../src/admin/allowlist-collection.js";
import {
  AllowlistStore,
  type AllowlistEntry,
} from "../src/policy/allowlist-store.js";
import { DEFAULT_PLAYBOOK } from "../src/policy/playbook.js";
import { ALLOWLISTED_SUBREDDITS } from "../src/reddit/config.js";

function entry(
  partial: Partial<AllowlistEntry> & Pick<AllowlistEntry, "name">
): AllowlistEntry {
  return {
    rulesOk: true,
    note: "",
    source: "discovered",
    status: "postable",
    score: 12,
    approvedCount: 0,
    abortedCount: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
    playbook: { ...DEFAULT_PLAYBOOK },
    ...partial,
  };
}

describe("AllowlistStore.remove", () => {
  it("removes a discovered entry and keeps it out of load()", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "allowlist-rm-"));
    const file = path.join(dir, "subreddits.json");
    await fs.writeFile(
      file,
      JSON.stringify({
        version: 1,
        entries: [entry({ name: "GoneSub" })],
      }),
      "utf8"
    );
    const store = new AllowlistStore(file);
    assert.equal(await store.remove("GoneSub"), true);
    assert.equal(await store.get("GoneSub"), undefined);
    const suppressed = await store.listSuppressed();
    assert.ok(suppressed.some((s) => s.toLowerCase() === "gonesub"));
    const exclude = await store.listDiscoverExclude(14);
    assert.ok(exclude.some((s) => s.toLowerCase() === "gonesub"));
  });

  it("suppresses a seed so mergeSeed does not revive it", async () => {
    const seed = ALLOWLISTED_SUBREDDITS.find((s) => s.rulesOk);
    assert.ok(seed);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "allowlist-seed-rm-"));
    const file = path.join(dir, "subreddits.json");
    await fs.writeFile(
      file,
      JSON.stringify({ version: 1, entries: [] }),
      "utf8"
    );
    const store = new AllowlistStore(file);
    assert.ok(await store.get(seed.name));
    assert.equal(await store.remove(seed.name), true);
    assert.equal(await store.get(seed.name), undefined);
    // Reload path: empty-ish file with suppressed must not re-add seed.
    const again = new AllowlistStore(file);
    assert.equal(await again.get(seed.name), undefined);
    const postable = await again.listPostable();
    assert.ok(!postable.some((e) => e.name.toLowerCase() === seed.name.toLowerCase()));
  });

  it("promote after remove clears suppression and restores postable", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "allowlist-promo-"));
    const file = path.join(dir, "subreddits.json");
    await fs.writeFile(
      file,
      JSON.stringify({
        version: 1,
        entries: [entry({ name: "ComeBack" })],
      }),
      "utf8"
    );
    const store = new AllowlistStore(file);
    await store.remove("ComeBack");
    assert.equal(await store.get("ComeBack"), undefined);
    const promoted = await store.promote("ComeBack", "restored via admin");
    assert.ok(promoted);
    assert.equal(promoted.status, "postable");
    assert.ok(
      !(await store.listSuppressed()).some(
        (s) => s.toLowerCase() === "comeback"
      )
    );
    assert.equal((await store.get("ComeBack"))?.status, "postable");
  });
});

describe("allowlist admin delete", () => {
  it("exposes delete capability and removes via collection.delete", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "allowlist-admin-"));
    const file = path.join(dir, "subreddits.json");
    await fs.writeFile(
      file,
      JSON.stringify({
        version: 1,
        entries: [entry({ name: "AdminGone" })],
      }),
      "utf8"
    );
    const col = createAllowlistCollection({ driver: "file", path: file });
    assert.equal(col.capabilities.delete, true);
    assert.equal(await col.delete?.("AdminGone"), true);
    assert.equal(await col.get("AdminGone"), null);
  });
});
