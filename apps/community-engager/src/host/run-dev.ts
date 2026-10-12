import "dotenv/config";
import { CliFeedbackAdapter } from "@relay/feedback-broker";
import {
  createTelegramAdapterFromEnv,
  TelegramFeedbackAdapter,
} from "@relay/adapters-telegram";
import { CommunityEngagerApp } from "../index.js";
import { formatRunSummary } from "../metrics/job-queue.js";
import type { CommunityEntrypoint } from "../manifest.js";

/** CLI: --force-discover | --discover=auto|force|off */
function applyDiscoverCliFlags(argv: string[]): void {
  for (const arg of argv) {
    if (arg === "--force-discover") {
      process.env.COMMUNITY_DISCOVER = "force";
      continue;
    }
    const m = /^--discover=(auto|force|off|true|false)$/i.exec(arg);
    if (m?.[1]) {
      process.env.COMMUNITY_DISCOVER = m[1].toLowerCase();
    }
  }
}

/**
 * CLI entrypoint selection:
 * - `--entrypoint engage` (default) | `--entrypoint post_watch`
 * - aliases: `watch posts`, `--watch-posts`
 */
function parseEntrypoint(argv: string[]): CommunityEntrypoint {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--watch-posts" || arg === "watch-posts") {
      return "post_watch";
    }
    if (arg === "watch" && argv[i + 1] === "posts") {
      return "post_watch";
    }
    const m = /^--entrypoint=(engage|post_watch)$/i.exec(arg);
    if (m?.[1]) {
      return m[1].toLowerCase() as CommunityEntrypoint;
    }
    if (arg === "--entrypoint") {
      const next = argv[i + 1]?.toLowerCase();
      if (next === "engage" || next === "post_watch") return next;
    }
  }
  return "engage";
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  applyDiscoverCliFlags(argv);
  const entrypoint = parseEntrypoint(argv);

  console.log(
    entrypoint === "post_watch"
      ? "=== Relay · CommunityPostWatch (dev) ===\n"
      : "=== Relay · CommunityEngager (dev) ===\n"
  );

  const useTelegram = process.env.FEEDBACK_ADAPTER === "telegram";
  let telegram: TelegramFeedbackAdapter | undefined;

  const adapter = useTelegram
    ? ((telegram = createTelegramAdapterFromEnv()), telegram)
    : new CliFeedbackAdapter();

  const app = new CommunityEngagerApp({ adapter, entrypoint });
  const memory = app.getMemory();
  const healthy = await memory.health();
  console.log(
    `Memory: ${memory.name}${healthy ? " (sidecar ok)" : " (unavailable / fail-open)"}\n`
  );
  console.log(`Entrypoint: ${entrypoint}\n`);

  if (telegram) {
    telegram.start();
    console.log("Feedback adapter: telegram (allowlisted user only)\n");
  } else {
    console.log("Feedback adapter: cli  (approve | abort | edit: …)\n");
    console.log("Set FEEDBACK_ADAPTER=telegram for Telegram HITL.\n");
  }

  if (entrypoint === "post_watch") {
    console.log(
      "Post-watch does not scout — it drains the enrolled queue only.\n" +
        "Schedule this separately (cron / launchd) or run manually after live posts.\n"
    );
  }

  try {
    const summary = await app.run();
    console.log(`\n=== Run summary ===\n${formatRunSummary(summary)}`);
  } finally {
    if (telegram) await telegram.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
