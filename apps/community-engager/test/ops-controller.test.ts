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

function silentLogger() {
  return { info() {}, warn() {}, error() {} };
}

describe("OpsController", () => {
  it("rejects second one-off while busy", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-ops-"));
    const host = new SchedulerHost({
      dataDir: dir,
      schedules: [],
      invoke: async () => {},
      logger: silentLogger(),
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
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(ops.isRunBusy(), true);
    assert.equal(ops.getActiveRun()?.label, "one-off engage");

    const busy = await ops.handleText("engage");
    assert.match(busy, /Busy/i);
    assert.match(busy, /one-off engage/);

    release();
    const done = await first;
    assert.match(done, /One-off engage finished/);
    assert.equal(runs, 1);
    assert.equal(ops.isRunBusy(), false);
  });

  it("runScheduled mutex: engage/trigger busy; status and pause still work", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-ops-"));
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
      invoke: async () => {},
      logger: silentLogger(),
      runOnStart: false,
    });
    await host.start();

    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });

    const ops = new OpsController({
      host,
      manifest: CommunityEngagerManifest,
      createApp: () => ({
        async run() {
          await gate;
          return emptySummary();
        },
      }),
      triggerSettleMs: 50,
    });

    const scheduled = ops.runScheduled({
      scheduleId: "cadence",
      entrypoint: "engage",
    });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(ops.isRunBusy(), true);
    assert.equal(ops.getActiveRun()?.kind, "schedule");

    const engageBusy = await ops.handleText("engage");
    assert.match(engageBusy, /Busy/i);
    assert.match(engageBusy, /schedule cadence/);

    const triggerBusy = await ops.handleText("run post watch now");
    assert.match(triggerBusy, /Busy/i);

    const startAllBusy = await ops.handleText("start schedules");
    assert.match(startAllBusy, /Busy/i);

    const status = await ops.handleText("status");
    assert.match(status, /Active run: schedule cadence/);
    assert.match(status, /Armed schedules/);

    const paused = await ops.handleText("stop cadence");
    assert.match(paused, /paused/i);
    assert.equal(host.isPaused("cadence"), true);

    release();
    const result = await scheduled;
    assert.equal(result.skipped, false);
    assert.equal(result.ran, true);
    assert.equal(ops.isRunBusy(), false);

    host.stop();
  });

  it("skips schedule invoke while one-off holds the mutex", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-ops-"));
    const host = new SchedulerHost({
      dataDir: dir,
      schedules: [],
      invoke: async () => {},
      logger: silentLogger(),
    });

    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let appRuns = 0;

    const ops = new OpsController({
      host,
      manifest: CommunityEngagerManifest,
      createApp: () => ({
        async run() {
          appRuns += 1;
          await gate;
          return emptySummary();
        },
      }),
    });

    const oneOff = ops.handleText("engage");
    await new Promise((r) => setTimeout(r, 10));

    const skipped = await ops.runScheduled({
      scheduleId: "post_watch",
      entrypoint: "post_watch",
    });
    assert.equal(skipped.skipped, true);
    assert.match(skipped.message, /skipped schedule post_watch/);
    assert.equal(appRuns, 1);

    release();
    await oneOff;
    assert.equal(ops.isRunBusy(), false);
  });

  it("pause cadence leaves post_watch armed; trigger while paused fails clearly", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-ops-"));
    const calls: string[] = [];
    let ops!: OpsController;
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
      invoke: async (ep, ctx) => {
        const entrypoint =
          ep === "post_watch" ? "post_watch" : ("engage" as const);
        calls.push(ep);
        await ops.runScheduled({
          scheduleId: ctx.schedule.id,
          entrypoint,
        });
      },
      logger: silentLogger(),
      runOnStart: false,
    });
    await host.start();

    ops = new OpsController({
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

    assert.equal(host.isArmed("cadence"), true);
    assert.equal(host.isPaused("cadence"), true);
    assert.equal(host.isArmed("post_watch"), true);
    assert.equal(host.isPaused("post_watch"), false);

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
