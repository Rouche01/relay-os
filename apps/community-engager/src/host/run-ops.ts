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
import { OpsController } from "../ops/index.js";
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

  const host = new SchedulerHost({
    dataDir,
    schedules,
    runOnStart: false,
    invoke: async (entrypoint, ctx) => {
      const appEntrypoint = toCommunityEntrypoint(entrypoint);
      console.log(
        `[ops-invoke] schedule=${ctx.schedule.id} entrypoint=${appEntrypoint}`
      );
      const app = new CommunityEngagerApp({
        adapter,
        entrypoint: appEntrypoint,
      });
      await app.run();
    },
  });

  const ops = new OpsController({
    host,
    manifest: CommunityEngagerManifest,
    createApp: (entrypoint) =>
      new CommunityEngagerApp({ adapter, entrypoint }),
  });

  try {
    // Arm schedules so status / pause / trigger work for this process.
    // One-offs do not require the host; ensureStarted is lazy inside controller.
    if (schedules.length > 0) {
      await host.start();
    }

    const reply = await ops.handleText(raw);
    console.log(reply);

    // Leave the process after the command (daemon wiring is P1).
    if (host.isStarted()) host.stop();
  } finally {
    if (telegram) await telegram.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
