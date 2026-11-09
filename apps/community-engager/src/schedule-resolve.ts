import {
  assertSchedulesValid,
  listEnabledSchedules,
  type AgenticAppManifest,
  type ScheduleDefinition,
} from "@relay/protocol";
import type { CommunityRuntimeConfig } from "./reddit/config.js";

/** Manifest schedule id for help-lane engage runs (legacy name). */
export const CADENCE_SCHEDULE_ID = "cadence";
export const PRESENCE_SCHEDULE_ID = "engage_presence";
export const CREATE_SCHEDULE_ID = "create";

/**
 * Merge manifest `schedules[]` with runtime cadence knobs.
 * Cadence / lane schedules use `@relay/scheduler` — no app-local cron.
 */
export function resolveCommunitySchedules(
  manifest: AgenticAppManifest,
  cfg: Pick<CommunityRuntimeConfig, "cadence" | "postWatch">
): ScheduleDefinition[] {
  const out: ScheduleDefinition[] = [];

  for (const s of manifest.schedules ?? []) {
    if (s.id === CADENCE_SCHEDULE_ID) {
      out.push({
        ...s,
        entrypoint: s.entrypoint || "default",
        cron: cfg.cadence.scheduleCron?.trim() || s.cron,
        every_ms: undefined,
        enabled:
          s.enabled !== false &&
          cfg.cadence.enabled &&
          cfg.cadence.scheduleEnabled,
        description:
          s.description ??
          "Help-lane engage under daily help/promo cadence caps",
      });
      continue;
    }

    if (s.id === PRESENCE_SCHEDULE_ID) {
      out.push({
        ...s,
        entrypoint: "engage_presence",
        cron: cfg.cadence.schedulePresenceCron?.trim() || s.cron,
        every_ms: undefined,
        enabled:
          cfg.cadence.enabled && cfg.cadence.schedulePresenceEnabled,
        description:
          s.description ??
          "Presence-lane engage under daily presence cadence caps",
      });
      continue;
    }

    if (s.id === CREATE_SCHEDULE_ID) {
      out.push({
        ...s,
        entrypoint: "create",
        cron: cfg.cadence.scheduleCreateCron?.trim() || s.cron,
        every_ms: undefined,
        enabled: cfg.cadence.enabled && cfg.cadence.scheduleCreateEnabled,
        description:
          s.description ??
          "Create-lane proposals under weekly create cadence caps",
      });
      continue;
    }

    if (s.id === "post_watch") {
      out.push({
        ...s,
        enabled: s.enabled !== false && cfg.postWatch.enabled,
      });
      continue;
    }

    out.push(s);
  }

  const projected: AgenticAppManifest = { ...manifest, schedules: out };
  assertSchedulesValid(projected);
  return out;
}

/** Enabled schedules after config merge (for SchedulerHost). */
export function resolveEnabledCommunitySchedules(
  manifest: AgenticAppManifest,
  cfg: Pick<CommunityRuntimeConfig, "cadence" | "postWatch">
): ScheduleDefinition[] {
  const schedules = resolveCommunitySchedules(manifest, cfg);
  return listEnabledSchedules({ ...manifest, schedules });
}

/** Per-fire job budget for a schedule id (lane cadences use tighter caps). */
export function maxJobsForSchedule(
  scheduleId: string,
  cfg: Pick<CommunityRuntimeConfig, "cadence" | "jobs">
): number | undefined {
  if (scheduleId === CADENCE_SCHEDULE_ID) {
    return cfg.cadence.maxJobsPerRun;
  }
  if (scheduleId === PRESENCE_SCHEDULE_ID) {
    return cfg.cadence.maxJobsPerRunPresence;
  }
  if (scheduleId === CREATE_SCHEDULE_ID) {
    return cfg.cadence.maxJobsPerRunCreate;
  }
  return undefined;
}
