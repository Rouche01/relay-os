import type { AgenticAppManifest } from "@relay/protocol";
import {
  DEFAULT_ENTRYPOINT,
  listEntrypointNames,
  resolveEntrypoint,
} from "@relay/protocol";
import type { CommunityEntrypoint } from "../manifest.js";
import { CADENCE_SCHEDULE_ID } from "../schedule-resolve.js";
import { OPS_HELP, type OpsCommand } from "./command.js";

const POST_WATCH_SCHEDULE_ID = "post_watch";

/**
 * Collapse whitespace and lowercase for exact phrase matching.
 * Telegram slash forms: `/status@Bot` → `status`, `/start_cadence` → `start cadence`.
 */
export function normalizeOpsText(text: string): string {
  let t = text.trim();
  if (t.startsWith("/")) {
    t = t.slice(1);
    const spaceIdx = t.search(/\s/);
    const first = spaceIdx === -1 ? t : t.slice(0, spaceIdx);
    const rest = spaceIdx === -1 ? "" : t.slice(spaceIdx);
    const at = first.indexOf("@");
    const cmd = at === -1 ? first : first.slice(0, at);
    t = `${cmd.replace(/_/g, " ")}${rest}`.trim();
  }
  return t.toLowerCase().replace(/\s+/g, " ");
}

/**
 * Parse operator text into an {@link OpsCommand}.
 * Longer control phrases win over short one-off aliases.
 * Also maps root / entrypoint `triggers[].pattern` and examples.
 */
export function parseOpsIntent(
  text: string,
  manifest: AgenticAppManifest
): OpsCommand {
  const n = normalizeOpsText(text);
  if (!n) {
    return { kind: "help", reason: "empty" };
  }

  if (n === "help" || n === "?" || n === "ops") {
    return { kind: "help" };
  }

  if (n === "status" || n === "schedules") {
    return { kind: "status" };
  }

  if (
    n === "start schedules" ||
    n === "start all" ||
    n === "start schedule"
  ) {
    return { kind: "start_all" };
  }
  if (
    n === "stop schedules" ||
    n === "stop all" ||
    n === "stop schedule"
  ) {
    return { kind: "stop_all" };
  }

  if (n === "start cadence") {
    return { kind: "start_schedule", scheduleId: CADENCE_SCHEDULE_ID };
  }
  if (n === "stop cadence") {
    return { kind: "stop_schedule", scheduleId: CADENCE_SCHEDULE_ID };
  }
  if (n === "run cadence now" || n === "trigger cadence") {
    return { kind: "trigger", scheduleId: CADENCE_SCHEDULE_ID };
  }

  if (
    n === "start post watch" ||
    n === "start post_watch" ||
    n === "start postwatch"
  ) {
    return { kind: "start_schedule", scheduleId: POST_WATCH_SCHEDULE_ID };
  }
  if (
    n === "stop post watch" ||
    n === "stop post_watch" ||
    n === "stop postwatch"
  ) {
    return { kind: "stop_schedule", scheduleId: POST_WATCH_SCHEDULE_ID };
  }
  if (
    n === "run post watch now" ||
    n === "run post_watch now" ||
    n === "trigger post watch" ||
    n === "trigger post_watch"
  ) {
    return { kind: "trigger", scheduleId: POST_WATCH_SCHEDULE_ID };
  }

  // Fixed one-off vocabulary (plan table)
  if (
    n === "engage" ||
    n === "engage community" ||
    n === "scout reddit"
  ) {
    return { kind: "one_off", entrypoint: "engage" };
  }
  if (
    n === "watch posts" ||
    n === "post watch" ||
    n === "post_watch" ||
    n === "postwatch"
  ) {
    return { kind: "one_off", entrypoint: "post_watch" };
  }

  const fromTriggers = matchManifestTriggers(n, manifest);
  if (fromTriggers) return fromTriggers;

  return { kind: "help", reason: `unknown: ${n}` };
}

function matchManifestTriggers(
  normalized: string,
  manifest: AgenticAppManifest
): OpsCommand | undefined {
  for (const name of listEntrypointNames(manifest)) {
    const resolved = resolveEntrypoint(manifest, name);
    const entrypoint = toCommunityEntrypoint(name);
    if (!entrypoint) continue;
    for (const phrase of triggerPhrases(resolved.triggers)) {
      if (phrase === normalized) {
        return { kind: "one_off", entrypoint };
      }
    }
  }
  return undefined;
}

function triggerPhrases(
  triggers: { pattern: string; examples?: string[] }[]
): string[] {
  const out: string[] = [];
  for (const t of triggers) {
    out.push(normalizeOpsText(t.pattern));
    for (const ex of t.examples ?? []) {
      out.push(normalizeOpsText(ex));
    }
  }
  return out;
}

function toCommunityEntrypoint(name: string): CommunityEntrypoint | undefined {
  if (name === DEFAULT_ENTRYPOINT || name === "engage") return "engage";
  if (name === "post_watch") return "post_watch";
  return undefined;
}

/** Human-readable help, optionally noting why parse fell through. */
export function formatOpsHelp(reason?: string): string {
  if (reason && reason !== "empty") {
    return `Unknown ops intent (${reason}).\n\n${OPS_HELP}`;
  }
  return OPS_HELP;
}
