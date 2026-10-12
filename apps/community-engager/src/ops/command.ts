import type { CommunityEntrypoint } from "../manifest.js";

/**
 * Parsed ops intents for CommunityEngager (CLI + Telegram idle).
 * HITL feedback is handled separately by FeedbackBroker.
 */
export type OpsCommand =
  | { kind: "one_off"; entrypoint: CommunityEntrypoint }
  | { kind: "start_schedule"; scheduleId: string }
  | { kind: "stop_schedule"; scheduleId: string }
  | { kind: "start_all" }
  | { kind: "stop_all" }
  | { kind: "trigger"; scheduleId: string }
  | { kind: "status" }
  | { kind: "help"; reason?: string };

export const OPS_HELP = `Ops intents (exact phrases):
  engage | engage community | scout reddit   — one-off engage
  watch posts | post watch                   — one-off post_watch
  start cadence | stop cadence               — pause/resume cadence schedule
  start post watch | stop post watch         — pause/resume post_watch schedule
  start schedules | stop schedules           — arm all / stop host
  run cadence now | run post watch now       — trigger schedule now
  status | schedules                         — armed list + next run
`.trim();
