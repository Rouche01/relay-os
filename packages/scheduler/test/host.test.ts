import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { AgenticAppManifest } from "@relay/protocol";
import { SchedulerHost } from "../src/host.js";
import { readScheduleEvidence } from "../src/evidence.js";

function silentLogger() {
  return {
    info() {},
    warn() {},
    error() {},
  };
}

describe("SchedulerHost", () => {
  it("fires every_ms schedule via trigger and writes evidence", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-sched-"));
    const calls: string[] = [];

    const host = new SchedulerHost({
      dataDir: dir,
      schedules: [
        {
          id: "post_watch",
          entrypoint: "post_watch",
          every_ms: 60_000,
          enabled: true,
        },
      ],
      invoke: async (entrypoint) => {
        calls.push(entrypoint);
      },
      logger: silentLogger(),
      runOnStart: false,
    });

    await host.start();
    assert.equal(calls.length, 0, "missed-tick skip: no immediate fire");

    await host.trigger("post_watch");
    // croner trigger may be sync kickoff; allow microtask/lease IO
    for (let i = 0; i < 50 && calls.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }

    assert.deepEqual(calls, ["post_watch"]);
    const evidence = await readScheduleEvidence(dir, "post_watch");
    assert.ok(evidence);
    assert.equal(evidence!.lastStatus, "ok");
    assert.equal(evidence!.runs, 1);
    assert.ok(evidence!.nextRunAt);

    const status = host.listStatus();
    assert.equal(status.length, 1);
    assert.equal(status[0]!.schedule.id, "post_watch");

    host.stop();
  });

  it("fromManifest arms only enabled schedules", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-sched-"));
    const manifest = {
      name: "T",
      version: "0",
      description: "t",
      author: "t",
      triggers: [],
      capabilities: [],
      engines_required: [],
      permissions: [],
      stages: [{ name: "a", description: "a", engine: "none" as const }],
      entrypoints: {
        post_watch: {
          description: "w",
          stages: [{ name: "w", description: "w", engine: "none" as const }],
        },
      },
      schedules: [
        {
          id: "on",
          entrypoint: "post_watch",
          every_ms: 60_000,
          enabled: true,
        },
        {
          id: "off",
          entrypoint: "post_watch",
          every_ms: 60_000,
          enabled: false,
        },
      ],
      feedback_patterns: [],
    } satisfies AgenticAppManifest;

    const host = SchedulerHost.fromManifest(manifest, {
      dataDir: dir,
      invoke: async () => {},
      logger: silentLogger(),
    });
    await host.start();
    assert.deepEqual(
      host.listStatus().map((s) => s.schedule.id),
      ["on"]
    );
    host.stop();
  });

  it("skips invoke when lease is held", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-sched-"));
    const lockDir = path.join(dir, "schedules");
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(
      path.join(lockDir, "post_watch.lock"),
      JSON.stringify({
        scheduleId: "post_watch",
        pid: process.pid,
        hostname: os.hostname(),
        acquiredAt: new Date().toISOString(),
      }),
      "utf8"
    );

    let calls = 0;
    const host = new SchedulerHost({
      dataDir: dir,
      schedules: [
        {
          id: "post_watch",
          entrypoint: "post_watch",
          every_ms: 60_000,
        },
      ],
      invoke: async () => {
        calls += 1;
      },
      logger: silentLogger(),
    });
    await host.start();
    await host.trigger("post_watch");
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 20));
      const ev = host.getEvidence("post_watch");
      if (ev?.lastStatus === "skipped_lease") break;
    }
    assert.equal(calls, 0);
    assert.equal(host.getEvidence("post_watch")?.lastStatus, "skipped_lease");
    host.stop();
  });
});
