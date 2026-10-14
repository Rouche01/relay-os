import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { SchedulerHost } from "@relay/scheduler";
import { CommunityEngagerManifest } from "../src/manifest.js";
import { handleOpsWithAck, opsProcessingAck } from "../src/ops/ack.js";
import { OpsController } from "../src/ops/controller.js";
import { parseOpsIntent } from "../src/ops/parse.js";
import type { RunSummary } from "../src/metrics/job-queue.js";

describe("opsProcessingAck", () => {
  const m = CommunityEngagerManifest;

  it("acks slow intents only", () => {
    assert.match(
      opsProcessingAck(parseOpsIntent("engage", m)) ?? "",
      /Starting one-off engage/
    );
    assert.match(
      opsProcessingAck(parseOpsIntent("run cadence now", m)) ?? "",
      /Triggering schedule "cadence"/
    );
    assert.match(
      opsProcessingAck(parseOpsIntent("start schedules", m)) ?? "",
      /Starting \/ resuming/
    );
    assert.equal(opsProcessingAck(parseOpsIntent("status", m)), null);
    assert.equal(opsProcessingAck(parseOpsIntent("stop cadence", m)), null);
    assert.equal(opsProcessingAck(parseOpsIntent("help", m)), null);
  });
});

describe("handleOpsWithAck", () => {
  it("notifies before a one-off and skips ack when busy", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-ops-ack-"));
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

    const ops = new OpsController({
      host,
      manifest: CommunityEngagerManifest,
      createApp: () => ({
        async run(): Promise<RunSummary> {
          await gate;
          return {
            runState: "COMPLETE",
            scouted: 0,
            skipped: 0,
            jobs: [],
            approved: 0,
            aborted: 0,
            failed: 0,
          };
        },
      }),
    });

    const acks: string[] = [];
    const first = handleOpsWithAck(
      ops,
      "engage",
      CommunityEngagerManifest,
      async (msg) => {
        acks.push(msg);
      }
    );
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(acks.length, 1);
    assert.match(acks[0]!, /Starting one-off engage/);

    const busy = await handleOpsWithAck(
      ops,
      "engage",
      CommunityEngagerManifest,
      async (msg) => {
        acks.push(msg);
      }
    );
    assert.match(busy, /Busy/i);
    assert.equal(acks.length, 1, "no second ack while busy");

    release();
    await first;
  });
});
