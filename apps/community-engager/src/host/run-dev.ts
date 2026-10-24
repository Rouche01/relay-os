import "dotenv/config";
import { CliFeedbackAdapter } from "@relay/feedback-broker";
import {
  createTelegramAdapterFromEnv,
  TelegramFeedbackAdapter,
} from "@relay/adapters-telegram";
import { CommunityEngagerApp } from "../index.js";
import { formatRunSummary } from "../metrics/job-queue.js";
import type { CommunityEntrypoint } from "../manifest.js";
import { buildRunSpec } from "../spec/build-run-spec.js";

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

function wantsSpec(argv: string[]): boolean {
  return (
    argv.includes("--with-spec") ||
    argv.includes("--spec") ||
    process.env.COMMUNITY_WITH_SPEC === "1" ||
    process.env.COMMUNITY_WITH_SPEC === "true"
  );
}

function parseSpecGoal(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const m = /^--goal=(.+)$/s.exec(arg);
    if (m?.[1]) return m[1].trim();
    if (arg === "--goal") {
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) return next.trim();
    }
  }
  return undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  applyDiscoverCliFlags(argv);
  const entrypoint = parseEntrypoint(argv);
  const withSpec = wantsSpec(argv);

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

  const spec = withSpec
    ? buildRunSpec({
        entrypoint,
        goal: parseSpecGoal(argv),
        forceDiscover: process.env.COMMUNITY_DISCOVER === "force",
        frozenBy: useTelegram ? "telegram-cli" : "cli",
      })
    : undefined;

  const app = new CommunityEngagerApp({ adapter, entrypoint, spec });
  const memory = app.getMemory();
  const healthy = await memory.health();
  console.log(
    `Memory: ${memory.name}${healthy ? " (sidecar ok)" : " (unavailable / fail-open)"}\n`
  );
  console.log(`Entrypoint: ${entrypoint}\n`);
  if (spec) {
    console.log(
      `Spec: ${spec.id} v${spec.version} status=${spec.status} ` +
        `entrypoint=${spec.procedure.entrypoint} dryRun=${spec.budget.dryRun} ` +
        `maxJobs=${spec.budget.maxJobs}\n` +
        `Goal: ${spec.goal}\n`
    );
  } else {
    console.log(
      "Spec: (none) — pass --with-spec to compile+freeze Intent→Spec for this run\n"
    );
  }

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
