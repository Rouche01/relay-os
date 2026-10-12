import {
  assertSchedulesValid,
  listEnabledSchedules,
  type AgenticAppManifest,
  type ScheduleDefinition,
} from "@relay/protocol";
import type { CommunityRuntimeConfig } from "./reddit/config.js";

/** Manifest schedule id for human-like engage runs (A5). */
export const CADENCE_SCHEDULE_ID = "cadence";

/**
 * Merge manifest `schedules[]` with runtime cadence knobs.
 * Cadence schedule uses `@relay/scheduler` — no app-local cron.
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
          "Human-like engage under daily help/promo cadence caps",
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

/** Per-fire job budget for a schedule id (cadence uses tighter caps). */
export function maxJobsForSchedule(
  scheduleId: string,
  cfg: Pick<CommunityRuntimeConfig, "cadence" | "jobs">
): number | undefined {
  if (scheduleId === CADENCE_SCHEDULE_ID) {
    return cfg.cadence.maxJobsPerRun;
  }
  return undefined;
}
