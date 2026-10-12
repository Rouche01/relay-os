import "dotenv/config";
import { CliFeedbackAdapter } from "@relay/feedback-broker";
import {
  createTelegramAdapterFromEnv,
  TelegramFeedbackAdapter,
} from "@relay/adapters-telegram";
import { SchedulerHost } from "@relay/scheduler";
import { CommunityEngagerApp } from "../index.js";
import { formatRunSummary } from "../job-queue.js";
import {
  CommunityEngagerManifest,
  type CommunityEntrypoint,
} from "../manifest.js";
import { getCommunityConfig } from "../reddit/config.js";
import {
  maxJobsForSchedule,
  resolveEnabledCommunitySchedules,
} from "../schedule-resolve.js";

function parseFlags(argv: string[]): {
  once: boolean;
  scheduleId?: string;
  runOnStart: boolean;
} {
  let once = false;
  let runOnStart = false;
  let scheduleId: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--once") once = true;
    if (arg === "--run-on-start") runOnStart = true;
    if (arg === "--schedule" && argv[i + 1]) {
      scheduleId = argv[++i];
    }
    const m = /^--schedule=(.+)$/.exec(arg);
    if (m?.[1]) scheduleId = m[1];
  }
  return { once, scheduleId, runOnStart };
}

function toCommunityEntrypoint(name: string): CommunityEntrypoint {
  if (name === "post_watch") return "post_watch";
  if (name === "default" || name === "engage") return "engage";
  throw new Error(
    `Scheduler entrypoint "${name}" is not a CommunityEngager entrypoint (engage|post_watch)`
  );
}

async function main(): Promise<void> {
  const { once, scheduleId, runOnStart } = parseFlags(process.argv.slice(2));
  const cfg = getCommunityConfig();
  const dataDir = cfg.reddit.dataDir;
  const schedules = resolveEnabledCommunitySchedules(
    CommunityEngagerManifest,
    cfg
  );

  console.log("=== Relay · CommunityEngager scheduler ===\n");
  console.log(`dataDir: ${dataDir}`);
  console.log(
    `schedules: ${schedules.map((s) => s.id).join(", ") || "(none enabled)"}\n`
  );

  const useTelegram = process.env.FEEDBACK_ADAPTER === "telegram";
  let telegram: TelegramFeedbackAdapter | undefined;
  const adapter = useTelegram
    ? ((telegram = createTelegramAdapterFromEnv()), telegram)
    : new CliFeedbackAdapter();

  if (telegram) {
    telegram.start();
    console.log("Feedback adapter: telegram\n");
  } else {
    console.log("Feedback adapter: cli\n");
  }

  const host = new SchedulerHost({
    dataDir,
    schedules,
    runOnStart,
    invoke: async (entrypoint, ctx) => {
      const appEntrypoint = toCommunityEntrypoint(entrypoint);
      const maxJobs = maxJobsForSchedule(ctx.schedule.id, cfg);
      console.log(
        `[scheduler-invoke] schedule=${ctx.schedule.id} entrypoint=${appEntrypoint}` +
          (maxJobs != null ? ` maxJobs=${maxJobs}` : "")
      );
      const app = new CommunityEngagerApp({
        adapter,
        entrypoint: appEntrypoint,
        ...(maxJobs != null ? { maxJobs } : {}),
      });
      const summary = await app.run();
      console.log(`\n=== Run summary ===\n${formatRunSummary(summary)}`);
    },
  });

  try {
    await host.start();

    if (scheduleId) {
      const known = host.listStatus().map((s) => s.schedule.id);
      if (!known.includes(scheduleId)) {
        throw new Error(
          `Schedule "${scheduleId}" is not armed (known: ${known.join(", ") || "none"})`
        );
      }
    }

    for (const row of host.listStatus()) {
      console.log(
        `  · ${row.schedule.id} → ${row.schedule.entrypoint}` +
          (row.schedule.cron ? ` cron=${row.schedule.cron}` : "") +
          (row.schedule.every_ms != null
            ? ` every_ms=${row.schedule.every_ms}`
            : "") +
          (row.nextRunAt ? ` next=${row.nextRunAt}` : "")
      );
    }
    console.log("");

    if (once) {
      const ids = scheduleId
        ? [scheduleId]
        : host.listStatus().map((s) => s.schedule.id);
      for (const id of ids) {
        console.log(`[scheduler] --once trigger ${id}`);
        await host.trigger(id);
        // Allow async croner callback + lease IO to settle
        await new Promise((r) => setTimeout(r, 250));
      }
      host.stop();
      return;
    }

    console.log(
      "Scheduler running (Ctrl+C to stop). Escape hatches: pnpm start / pnpm watch:posts\n"
    );

    await new Promise<void>((resolve) => {
      const shutdown = () => {
        host.stop();
        resolve();
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    });
  } finally {
    if (telegram) await telegram.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
