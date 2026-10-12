import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { writeScheduleEvidence } from "@relay/scheduler";
import { createSchedulesCollection } from "../src/admin/schedules-collection.js";
import { CommunityEngagerManifest } from "../src/manifest.js";

describe("schedules admin collection (A4)", () => {
  it("lists overview, entrypoints, and schedules", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-sched-admin-"));
    const col = createSchedulesCollection(
      { driver: "file", path: dir },
      { manifest: CommunityEngagerManifest, applyRuntimeConfig: false }
    );

    const list = await col.list();
    const ids = list.rows.map((r) => r.id);
    assert.ok(ids.includes("overview"));
    assert.ok(ids.includes("entrypoint:engage"));
    assert.ok(ids.includes("entrypoint:post_watch"));
    assert.ok(ids.includes("cadence"));
    assert.ok(ids.includes("post_watch"));

    const cadenceRow = list.rows.find((r) => r.id === "cadence");
    assert.equal(cadenceRow?.kind, "schedule");
    assert.equal(cadenceRow?.entrypoint, "default");
    assert.equal(cadenceRow?.enabled, "on");

    const scheduleRow = list.rows.find((r) => r.id === "post_watch");
    assert.equal(scheduleRow?.kind, "schedule");
    assert.equal(scheduleRow?.entrypoint, "post_watch");
    assert.equal(scheduleRow?.enabled, "on");
    assert.equal(scheduleRow?.lastStatus, "never");
  });

  it("get overview includes viz; schedule get surfaces evidence", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-sched-admin-"));
    await writeScheduleEvidence(dir, {
      scheduleId: "post_watch",
      entrypoint: "post_watch",
      runs: 3,
      lastStatus: "ok",
      lastFinishedAt: "2026-10-12T10:00:00.000Z",
      nextRunAt: "2026-10-12T16:00:00.000Z",
      updatedAt: "2026-10-12T10:00:00.000Z",
    });

    const col = createSchedulesCollection(
      { driver: "file", path: dir },
      { manifest: CommunityEngagerManifest, applyRuntimeConfig: false }
    );

    const overview = await col.get("overview");
    assert.ok(overview);
    assert.equal(overview!.detail?.kind, "schedules-overview");
    assert.ok(overview!.detail?.viz);
    const viz = overview!.detail!.viz as {
      entrypoints: unknown[];
      schedules: Array<{
        id: string;
        nextRunAt?: string;
        runs?: number;
        paused?: boolean;
      }>;
    };
    assert.ok(viz.entrypoints.length >= 2);
    const pw = viz.schedules.find((s) => s.id === "post_watch");
    assert.equal(pw?.nextRunAt, "2026-10-12T16:00:00.000Z");
    assert.equal(pw?.runs, 3);
    assert.equal(pw?.paused, false);

    const item = await col.get("post_watch");
    assert.ok(item);
    assert.equal(item!.detail?.kind, "schedules-overview");
    assert.match(item!.detail?.subtitle ?? "", /next 2026-10-12T16:00:00/);
  });

  it("surfaces paused runtime from evidence", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-sched-admin-"));
    await writeScheduleEvidence(dir, {
      scheduleId: "cadence",
      entrypoint: "default",
      runs: 1,
      lastStatus: "ok",
      paused: true,
      updatedAt: "2026-10-12T10:00:00.000Z",
    });

    const col = createSchedulesCollection(
      { driver: "file", path: dir },
      { manifest: CommunityEngagerManifest, applyRuntimeConfig: false }
    );

    const list = await col.list();
    const cadence = list.rows.find((r) => r.id === "cadence");
    assert.equal(cadence?.runtime, "paused");
    assert.equal(cadence?.nextRunAt, "—");

    const item = await col.get("cadence");
    assert.ok(item);
    assert.match(item!.detail?.subtitle ?? "", /paused/);
    const viz = item!.detail!.viz as {
      schedules: Array<{ id: string; paused?: boolean; nextRunAt?: string }>;
    };
    assert.equal(viz.schedules[0]?.paused, true);
    assert.equal(viz.schedules[0]?.nextRunAt, undefined);
  });
});
