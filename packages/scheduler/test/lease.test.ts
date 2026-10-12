import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { tryAcquireLease } from "../src/lease.js";

describe("tryAcquireLease", () => {
  it("acquires and releases exclusively", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-lease-"));
    const a = await tryAcquireLease(dir, "post_watch");
    assert.ok(a);
    const b = await tryAcquireLease(dir, "post_watch");
    assert.equal(b, null);
    await a!.release();
    const c = await tryAcquireLease(dir, "post_watch");
    assert.ok(c);
    await c!.release();
  });

  it("steals stale lock when pid is dead", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-lease-"));
    const lockDir = path.join(dir, "schedules");
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(
      path.join(lockDir, "post_watch.lock"),
      JSON.stringify({
        scheduleId: "post_watch",
        pid: 999_999_999,
        hostname: "ghost",
        acquiredAt: new Date(Date.now() - 60_000).toISOString(),
      }),
      "utf8"
    );
    const lease = await tryAcquireLease(dir, "post_watch");
    assert.ok(lease);
    assert.equal(lease!.payload.pid, process.pid);
    await lease!.release();
  });
});
