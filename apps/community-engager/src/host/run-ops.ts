import "dotenv/config";
import { CliFeedbackAdapter } from "@relay/feedback-broker";
import {
  createTelegramAdapterFromEnv,
  TelegramFeedbackAdapter,
} from "@relay/adapters-telegram";
import { SchedulerHost } from "@relay/scheduler";
import { CommunityEngagerApp } from "../index.js";
import {
  CommunityEngagerManifest,
  type CommunityEntrypoint,
} from "../manifest.js";
import { handleOpsWithAck, OpsController } from "../ops/index.js";
import { getCommunityConfig } from "../reddit/config.js";
import { resolveEnabledCommunitySchedules } from "../schedule-resolve.js";

function usage(): never {
  console.log(`Usage:
  pnpm ops -- "<intent>"
  pnpm ops -- status
  pnpm ops -- "run cadence now"
  pnpm ops -- engage
  pnpm ops -- "stop cadence"

Short-lived process (arms schedules, runs one intent, exits).
For a long-lived host that keeps pause/resume state, use:
  pnpm scheduler
and type the same intents on stdin (CLI adapter).
`);
  process.exit(1);
}

function toCommunityEntrypoint(name: string): CommunityEntrypoint {
  if (name === "post_watch") return "post_watch";
  if (name === "default" || name === "engage") return "engage";
  throw new Error(
    `Scheduler entrypoint "${name}" is not a CommunityEngager entrypoint (engage|post_watch)`
  );
}

async function main(): Promise<void> {
  const raw = process.argv.slice(2).join(" ").trim();
  if (!raw || raw === "-h" || raw === "--help") usage();

  const cfg = getCommunityConfig();
  const dataDir = cfg.reddit.dataDir;
  const schedules = resolveEnabledCommunitySchedules(
    CommunityEngagerManifest,
    cfg
  );

  const useTelegram = process.env.FEEDBACK_ADAPTER === "telegram";
  let telegram: TelegramFeedbackAdapter | undefined;
  const adapter = useTelegram
    ? ((telegram = createTelegramAdapterFromEnv()), telegram)
    : new CliFeedbackAdapter();

  if (telegram) {
    telegram.start();
  }

  let ops!: OpsController;

  const host = new SchedulerHost({
    dataDir,
    schedules,
    runOnStart: false,
    invoke: async (entrypoint, ctx) => {
      const appEntrypoint = toCommunityEntrypoint(entrypoint);
      console.log(
        `[ops-invoke] schedule=${ctx.schedule.id} entrypoint=${appEntrypoint}`
      );
      const result = await ops.runScheduled({
        scheduleId: ctx.schedule.id,
        entrypoint: appEntrypoint,
      });
      if (result.skipped) {
        console.warn(`[ops-invoke] ${result.message}`);
        return;
      }
      console.log(result.message);
    },
  });

  ops = new OpsController({
    host,
    manifest: CommunityEngagerManifest,
    createApp: (entrypoint, options) =>
      new CommunityEngagerApp({
        adapter,
        entrypoint,
        ...(options?.maxJobs != null ? { maxJobs: options.maxJobs } : {}),
        ...(options?.forceDiscover ? { forceDiscover: true } : {}),
      }),
  });

  try {
    // Arm schedules so status / pause / trigger work for this process.
    // One-offs do not require the host; ensureStarted is lazy inside controller.
    if (schedules.length > 0) {
      await host.start();
    }

    const reply = await handleOpsWithAck(
      ops,
      raw,
      CommunityEngagerManifest,
      async (msg) => {
        console.log(msg);
        if (telegram) await telegram.notify(msg);
      }
    );
    console.log(reply);

    if (host.isStarted()) host.stop();
  } finally {
    if (telegram) await telegram.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
