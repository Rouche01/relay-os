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
  engage | engage community | scout reddit   — one-off help engage (/engage)
  engage help | /engage_help                 — help-lane engage
  engage presence | /engage_presence         — presence-lane engage
  create propose | /create_propose           — create-lane proposal (stub until remodel)
  engage discover | engage with discover     — one-off engage + force discover (/engage_discover)
  watch posts | post watch                   — one-off post_watch (/watch_posts)
  start cadence | stop cadence               — pause/resume help cadence (/start_cadence · /stop_cadence)
  start presence | stop presence             — pause/resume presence schedule (/start_presence · /stop_presence)
  start create | stop create                 — pause/resume create schedule (/start_create · /stop_create)
  start post watch | stop post watch         — pause/resume post_watch (/start_post_watch · /stop_post_watch)
  start schedules | stop schedules           — arm all / stop host (/start_schedules · /stop_schedules)
  run cadence now | run presence now | run create now | run post watch now — trigger (/run_*_now)
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
  { command: "engage", description: "One-off help engage run" },
  { command: "engage_help", description: "Help-lane engage" },
  { command: "engage_presence", description: "Presence-lane engage" },
  { command: "create_propose", description: "Create-lane proposal" },
  {
    command: "engage_discover",
    description: "One-off engage with forced discover",
  },
  { command: "watch_posts", description: "One-off post_watch run" },
  { command: "start_cadence", description: "Resume help cadence schedule" },
  { command: "stop_cadence", description: "Pause help cadence schedule" },
  { command: "start_presence", description: "Resume presence schedule" },
  { command: "stop_presence", description: "Pause presence schedule" },
  { command: "start_create", description: "Resume create schedule" },
  { command: "stop_create", description: "Pause create schedule" },
  { command: "start_post_watch", description: "Resume post_watch schedule" },
  { command: "stop_post_watch", description: "Pause post_watch schedule" },
  { command: "start_schedules", description: "Arm all enabled schedules" },
  { command: "stop_schedules", description: "Stop scheduler host" },
  { command: "run_cadence_now", description: "Trigger help cadence now" },
  { command: "run_presence_now", description: "Trigger presence schedule now" },
  { command: "run_create_now", description: "Trigger create schedule now" },
  { command: "run_post_watch_now", description: "Trigger post_watch now" },
];
