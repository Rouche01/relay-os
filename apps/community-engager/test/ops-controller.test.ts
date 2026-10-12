import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { SchedulerHost } from "@relay/scheduler";
import { CommunityEngagerManifest } from "../src/manifest.js";
import { OpsController } from "../src/ops/controller.js";
import type { RunSummary } from "../src/metrics/job-queue.js";

function emptySummary(): RunSummary {
  return {
    runState: "COMPLETE",
    scouted: 0,
    skipped: 0,
    jobs: [],
    approved: 0,
    aborted: 0,
    failed: 0,
  };
}

describe("OpsController", () => {
  it("rejects second one-off while busy", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-ops-"));
    const host = new SchedulerHost({
      dataDir: dir,
      schedules: [],
      invoke: async () => {},
      logger: { info() {}, warn() {}, error() {} },
    });

    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let runs = 0;

    const ops = new OpsController({
      host,
      manifest: CommunityEngagerManifest,
      createApp: () => ({
        async run() {
          runs += 1;
          await gate;
          return emptySummary();
        },
      }),
    });

    const first = ops.handleText("engage");
    // Let first claim the mutex
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(ops.isOneOffBusy(), true);

    const busy = await ops.handleText("engage");
    assert.match(busy, /Busy/i);

    release();
    const done = await first;
    assert.match(done, /One-off engage finished/);
    assert.equal(runs, 1);
    assert.equal(ops.isOneOffBusy(), false);
  });

  it("pause cadence leaves post_watch armed; trigger while paused fails clearly", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-ops-"));
    const calls: string[] = [];
    const host = new SchedulerHost({
      dataDir: dir,
      schedules: [
        {
          id: "cadence",
          entrypoint: "default",
          every_ms: 60_000,
          enabled: true,
        },
        {
          id: "post_watch",
          entrypoint: "post_watch",
          every_ms: 60_000,
          enabled: true,
        },
      ],
      invoke: async (ep) => {
        calls.push(ep);
      },
      logger: { info() {}, warn() {}, error() {} },
      runOnStart: false,
    });
    await host.start();

    const ops = new OpsController({
      host,
      manifest: CommunityEngagerManifest,
      createApp: () => ({
        async run() {
          return emptySummary();
        },
      }),
      triggerSettleMs: 50,
    });

    const paused = await ops.handleText("stop cadence");
    assert.match(paused, /paused/i);

    const status = await ops.handleText("status");
    assert.match(status, /Armed schedules \(1 paused\)/);
    assert.match(status, /cadence.*\[armed,paused\]/);
    assert.match(status, /post_watch.*\[armed,active\]/);

    const rejected = await ops.handleText("run cadence now");
    assert.match(rejected, /paused/i);
    assert.equal(calls.length, 0);

    await ops.handleText("start cadence");
    const triggered = await ops.handleText("run post watch now");
    assert.match(triggered, /Triggered "post_watch"/);
    for (let i = 0; i < 50 && calls.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.deepEqual(calls, ["post_watch"]);

    host.stop();
  });
});
