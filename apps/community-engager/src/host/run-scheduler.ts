import "dotenv/config";
import * as readline from "node:readline";
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

/**
 * Long-lived ops daemon: SchedulerHost + OpsController.
 * - CLI: type ops intents on stdin (paused while an app run owns HITL).
 * - Telegram: idle allowlisted messages → OpsController (HITL pending wins).
 * - One run mutex shared by one-offs and schedule ticks.
 * Escape hatch: `--once` / `--schedule` still work via the same controller.
 */
async function main(): Promise<void> {
  const { once, scheduleId, runOnStart } = parseFlags(process.argv.slice(2));
  const cfg = getCommunityConfig();
  const dataDir = cfg.reddit.dataDir;
  const schedules = resolveEnabledCommunitySchedules(
    CommunityEngagerManifest,
    cfg
  );

  console.log("=== Relay · CommunityEngager ops daemon ===\n");
  console.log(`dataDir: ${dataDir}`);
  console.log(
    `schedules: ${schedules.map((s) => s.id).join(", ") || "(none enabled)"}\n`
  );

  const useTelegram = process.env.FEEDBACK_ADAPTER === "telegram";
  let telegram: TelegramFeedbackAdapter | undefined;
  const adapter = useTelegram
    ? ((telegram = createTelegramAdapterFromEnv()), telegram)
    : new CliFeedbackAdapter();

  /** Pause stdin ops while HITL / app.run owns the terminal. */
  let opsRl: readline.Interface | undefined;
  const withStdinReleased = async <T>(fn: () => Promise<T>): Promise<T> => {
    opsRl?.pause();
    try {
      return await fn();
    } finally {
      opsRl?.resume();
    }
  };

  const createApp = (
    entrypoint: CommunityEntrypoint,
    options?: { maxJobs?: number }
  ) => ({
    run: () =>
      withStdinReleased(async () => {
        const app = new CommunityEngagerApp({
          adapter,
          entrypoint,
          ...(options?.maxJobs != null ? { maxJobs: options.maxJobs } : {}),
        });
        return app.run();
      }),
  });

  // Host is created after ops so invoke can close over the controller.
  let ops!: OpsController;

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
      const result = await ops.runScheduled({
        scheduleId: ctx.schedule.id,
        entrypoint: appEntrypoint,
        ...(maxJobs != null ? { maxJobs } : {}),
      });
      if (result.skipped) {
        console.warn(`[scheduler-invoke] ${result.message}`);
        return;
      }
      console.log(`\n=== Run summary ===\n${result.message}`);
    },
  });

  ops = new OpsController({
    host,
    manifest: CommunityEngagerManifest,
    createApp,
  });

  const runOpsLine = async (text: string): Promise<string> => {
    console.log(`[ops] ${text}`);
    return handleOpsWithAck(
      ops,
      text,
      CommunityEngagerManifest,
      async (msg) => {
        console.log(`[ops] ${msg}`);
        if (telegram) await telegram.notify(msg);
      }
    );
  };

  if (telegram) {
    telegram.setOnIdleMessage(async (text) => runOpsLine(text));
    telegram.start();
    console.log("Feedback adapter: telegram (idle → ops)\n");
  } else {
    console.log("Feedback adapter: cli\n");
  }

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    opsRl?.close();
    if (host.isStarted()) host.stop();
  };

  try {
    if (schedules.length > 0) {
      await host.start();
    } else {
      console.log("[ops] no enabled schedules — host idle until start schedules\n");
    }

    if (scheduleId && !host.isArmed(scheduleId)) {
      const known = host.listStatus().map((s) => s.schedule.id);
      throw new Error(
        `Schedule "${scheduleId}" is not armed (known: ${known.join(", ") || "none"})`
      );
    }

    console.log(await ops.handle({ kind: "status" }));
    console.log("");

    if (once) {
      const ids = scheduleId
        ? [scheduleId]
        : host.listStatus().map((s) => s.schedule.id);
      for (const id of ids) {
        console.log(`[ops] --once → run ${id} now`);
        console.log(await ops.handle({ kind: "trigger", scheduleId: id }));
      }
      shutdown();
      return;
    }

    if (useTelegram) {
      console.log(
        "Ops daemon running (Ctrl+C to stop).\n" +
          "Telegram: send status / stop cadence / engage / … when no HITL card is pending.\n"
      );
    } else {
      console.log(
        "Ops daemon running. Type intents (status, stop cadence, engage, …),\n" +
          "or quit / Ctrl+C. Escape hatches: pnpm start / pnpm watch:posts / --once\n"
      );
      opsRl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: process.stdin.isTTY === true,
      });
      opsRl.on("line", (line) => {
        void (async () => {
          const text = line.trim();
          if (!text) return;
          if (text === "quit" || text === "exit") {
            shutdown();
            return;
          }
          try {
            const reply = await runOpsLine(text);
            console.log(`${reply}\n`);
          } catch (err) {
            console.error("[ops]", err);
          }
        })();
      });
      opsRl.on("close", () => {
        if (!shuttingDown) shutdown();
      });
    }

    await new Promise<void>((resolve) => {
      const onSignal = () => {
        shutdown();
        resolve();
      };
      process.once("SIGINT", onSignal);
      process.once("SIGTERM", onSignal);
      if (opsRl) {
        opsRl.once("close", () => resolve());
      }
    });
  } finally {
    shutdown();
    if (telegram) await telegram.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
