import type { CommunityEntrypoint } from "../manifest.js";

/**
 * Parsed ops intents for CommunityEngager (CLI + Telegram idle).
 * HITL feedback is handled separately by FeedbackBroker.
 */
export type OpsCommand =
  | {
      kind: "one_off";
      entrypoint: CommunityEntrypoint;
      /** Engage only: force discover gate this run (does not consume empty-scout day ledger). */
      forceDiscover?: boolean;
    }
  | { kind: "start_schedule"; scheduleId: string }
  | { kind: "stop_schedule"; scheduleId: string }
  | { kind: "start_all" }
  | { kind: "stop_all" }
  | { kind: "trigger"; scheduleId: string }
  | { kind: "status" }
  | { kind: "help"; reason?: string };

export const OPS_HELP = `Ops intents (exact phrases; Telegram also accepts /slash forms):
  engage | engage community | scout reddit   — one-off engage (/engage)
  engage discover | engage with discover     — one-off engage + force discover (/engage_discover)
  watch posts | post watch                   — one-off post_watch (/watch_posts)
  start cadence | stop cadence               — pause/resume cadence (/start_cadence · /stop_cadence)
  start post watch | stop post watch         — pause/resume post_watch (/start_post_watch · /stop_post_watch)
  start schedules | stop schedules           — arm all / stop host (/start_schedules · /stop_schedules)
  run cadence now | run post watch now       — trigger schedule now (/run_cadence_now · /run_post_watch_now)
  status | schedules                         — armed list + next run (/status)
  help                                       — this vocabulary (/help)
`.trim();

/** Bot API BotCommand entries for Telegram `/` menu (daemon registers via setMyCommands). */
export const OPS_TELEGRAM_COMMANDS: ReadonlyArray<{
  command: string;
  description: string;
}> = [
  { command: "help", description: "Ops vocabulary" },
  { command: "status", description: "Armed schedules + next run" },
  { command: "engage", description: "One-off engage run" },
  {
    command: "engage_discover",
    description: "One-off engage with forced discover",
  },
  { command: "watch_posts", description: "One-off post_watch run" },
  { command: "start_cadence", description: "Resume cadence schedule" },
  { command: "stop_cadence", description: "Pause cadence schedule" },
  { command: "start_post_watch", description: "Resume post_watch schedule" },
  { command: "stop_post_watch", description: "Pause post_watch schedule" },
  { command: "start_schedules", description: "Arm all enabled schedules" },
  { command: "stop_schedules", description: "Stop scheduler host" },
  { command: "run_cadence_now", description: "Trigger cadence now" },
  { command: "run_post_watch_now", description: "Trigger post_watch now" },
];
