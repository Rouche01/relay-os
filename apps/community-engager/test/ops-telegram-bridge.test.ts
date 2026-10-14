import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { TelegramFeedbackAdapter } from "@relay/adapters-telegram";
import { SchedulerHost } from "@relay/scheduler";
import { CommunityEngagerManifest } from "../src/manifest.js";
import { OpsController } from "../src/ops/controller.js";
import type { RunSummary } from "../src/metrics/job-queue.js";

/**
 * Daemon wiring shape: Telegram idle → OpsController.handleText → reply.
 * Mirrors run-scheduler setOnIdleMessage without starting a real poll loop.
 */
describe("Telegram idle → OpsController bridge", () => {
  it("routes idle status through ops and replies", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-ops-tg-"));
    const sent: string[] = [];
    let messageId = 100;

    const host = new SchedulerHost({
      dataDir: dir,
      schedules: [
        {
          id: "cadence",
          entrypoint: "default",
          every_ms: 60_000,
          enabled: true,
        },
      ],
      invoke: async () => {},
      logger: { info() {}, warn() {}, error() {} },
      runOnStart: false,
    });
    await host.start();

    const ops = new OpsController({
      host,
      manifest: CommunityEngagerManifest,
      createApp: () => ({
        async run(): Promise<RunSummary> {
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

    const adapter = new TelegramFeedbackAdapter({
      botToken: "test",
      allowlistUserId: 7,
      client: {
        async sendMessage(params: { text: string; chat_id: number }) {
          sent.push(params.text);
          messageId += 1;
          return {
            message_id: messageId,
            chat: { id: params.chat_id },
            date: 0,
          };
        },
        async getUpdates() {
          return [];
        },
        async answerCallbackQuery() {},
        async editMessageReplyMarkup() {},
      },
    });

    adapter.setOnIdleMessage(async (text) => ops.handleText(text));

    const waitSent = async (n: number) => {
      const deadline = Date.now() + 2000;
      while (sent.length < n) {
        if (Date.now() > deadline) throw new Error(`expected ${n} sent`);
        await new Promise((r) => setTimeout(r, 10));
      }
    };

    await adapter.ingestAllowlistedText("status");
    await waitSent(1);
    assert.match(sent[0]!, /Armed schedules/);
    assert.match(sent[0]!, /cadence.*\[armed,active\]/);

    await adapter.ingestAllowlistedText("stop cadence");
    await waitSent(2);
    assert.match(sent.at(-1)!, /paused/i);
    assert.equal(host.isPaused("cadence"), true);

    await adapter.ingestAllowlistedText("dance monkey");
    await waitSent(3);
    assert.match(sent.at(-1)!, /Unknown ops intent|Ops intents/i);

    host.stop();
  });
});
