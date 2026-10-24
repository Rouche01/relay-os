import "dotenv/config";
import { CliFeedbackAdapter } from "@relay/feedback-broker";
import {
  createTelegramAdapterFromEnv,
  TelegramFeedbackAdapter,
} from "@relay/adapters-telegram";
import { CommunityEngagerApp } from "../index.js";
import { formatRunSummary } from "../metrics/job-queue.js";
import type { CommunityEntrypoint } from "../manifest.js";
import { buildRunSpecBundle } from "../spec/build-run-spec.js";
import type { FeedbackAdapterKind } from "../spec/engage-compiler.js";

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

function skipSpecHitl(argv: string[]): boolean {
  return (
    argv.includes("--skip-spec-hitl") ||
    process.env.COMMUNITY_SKIP_SPEC_HITL === "1" ||
    process.env.COMMUNITY_SKIP_SPEC_HITL === "true"
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

/** `--adapter=cli|telegram` or `--adapter cli` — Intent slot for HITL surface. */
function parseAdapterArg(argv: string[]): FeedbackAdapterKind | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const m = /^--adapter=(cli|telegram|tg|terminal)$/i.exec(arg);
    if (m?.[1]) {
      const v = m[1].toLowerCase();
      if (v === "telegram" || v === "tg") return "telegram";
      return "cli";
    }
    if (arg === "--adapter") {
      const next = argv[i + 1]?.toLowerCase();
      if (next === "telegram" || next === "tg") return "telegram";
      if (next === "cli" || next === "terminal") return "cli";
    }
  }
  return undefined;
}

function resolveAdapterKind(
  argv: string[],
  fromSpec?: FeedbackAdapterKind
): FeedbackAdapterKind {
  const fromArg = parseAdapterArg(argv);
  if (fromArg) return fromArg;
  if (fromSpec) return fromSpec;
  if (
    process.env.FEEDBACK_ADAPTER === "telegram" ||
    process.env.COMMUNITY_ADAPTER === "telegram"
  ) {
    return "telegram";
  }
  return "cli";
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  applyDiscoverCliFlags(argv);
  const entrypoint = parseEntrypoint(argv);
  const withSpec = wantsSpec(argv);
  const adapterFromArg = parseAdapterArg(argv);

  console.log(
    entrypoint === "post_watch"
      ? "=== Relay · CommunityPostWatch (dev) ===\n"
      : "=== Relay · CommunityEngager (dev) ===\n"
  );

  const bundle = withSpec
    ? buildRunSpecBundle({
        entrypoint,
        goal: parseSpecGoal(argv),
        forceDiscover: process.env.COMMUNITY_DISCOVER === "force",
        adapter: adapterFromArg,
        frozenBy: adapterFromArg ?? "cli",
      })
    : undefined;

  const adapterKind = resolveAdapterKind(argv, bundle?.adapter);
  let telegram: TelegramFeedbackAdapter | undefined;

  const adapter =
    adapterKind === "telegram"
      ? ((telegram = createTelegramAdapterFromEnv()), telegram)
      : new CliFeedbackAdapter();

  const spec = bundle?.spec;

  const app = new CommunityEngagerApp({
    adapter,
    entrypoint,
    spec,
    specHitl: spec ? !skipSpecHitl(argv) : false,
  });
  const memory = app.getMemory();
  const healthy = await memory.health();
  console.log(
    `Memory: ${memory.name}${healthy ? " (sidecar ok)" : " (unavailable / fail-open)"}\n`
  );
  console.log(`Entrypoint: ${entrypoint}\n`);
  console.log(`Adapter: ${adapterKind}\n`);
  if (spec) {
    console.log(
      `Spec: ${spec.id} v${spec.version} status=${spec.status} ` +
        `entrypoint=${spec.procedure.entrypoint} dryRun=${spec.budget.dryRun} ` +
        `maxJobs=${spec.budget.maxJobs}\n` +
        `Goal: ${spec.goal}\n` +
        (bundle?.intent
          ? `Intent slots.adapter=${String(bundle.intent.slots.adapter ?? "(unset)")}\n`
          : "") +
        (skipSpecHitl(argv)
          ? "Spec HITL: skipped (--skip-spec-hitl)\n"
          : "Spec HITL: you will Approve / Edit / Abort the Spec before stages run\n")
    );
  } else {
    console.log(
      "Spec: (none) — pass --with-spec to compile+freeze Intent→Spec for this run\n" +
        "Adapter still selectable via --adapter=cli|telegram or FEEDBACK_ADAPTER\n"
    );
  }

  if (telegram) {
    telegram.start();
    console.log("Feedback adapter: telegram (allowlisted user only)\n");
  } else {
    console.log("Feedback adapter: cli  (approve | abort | edit: …)\n");
    console.log(
      "Telegram HITL: --adapter=telegram, Intent slot adapter=telegram, or FEEDBACK_ADAPTER=telegram\n"
    );
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
