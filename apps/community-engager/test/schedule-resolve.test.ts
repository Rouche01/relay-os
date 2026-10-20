import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CommunityEngagerManifest } from "../src/manifest.js";
import {
  CADENCE_SCHEDULE_ID,
  maxJobsForSchedule,
  resolveCommunitySchedules,
  resolveEnabledCommunitySchedules,
} from "../src/schedule-resolve.js";

const baseCfg = {
  cadence: {
    enabled: true,
    maxHelpPerDay: 5,
    maxPromoPerDay: 1,
    scheduleEnabled: true,
    scheduleCron: "0 10,16 * * *",
    maxJobsPerRun: 2,
  },
  postWatch: {
    enabled: true,
    firstCheckAfterHours: 1,
    minAgeHours: 1,
    maxAgeHours: 72,
    maxPerRun: 10,
    followUpIntensity: 0 as const,
  },
  jobs: { maxJobs: 3, delayMs: 1500 },
};

describe("resolveCommunitySchedules (A5)", () => {
  it("applies cadence cron + maxJobsPerRun; keeps post_watch", () => {
    const schedules = resolveCommunitySchedules(CommunityEngagerManifest, baseCfg);
    const cadence = schedules.find((s) => s.id === CADENCE_SCHEDULE_ID);
    assert.ok(cadence);
    assert.equal(cadence!.entrypoint, "default");
    assert.equal(cadence!.cron, "0 10,16 * * *");
    assert.equal(cadence!.enabled, true);
    assert.ok(schedules.some((s) => s.id === "post_watch" && s.enabled !== false));
    assert.equal(maxJobsForSchedule(CADENCE_SCHEDULE_ID, baseCfg), 2);
    assert.equal(maxJobsForSchedule("post_watch", baseCfg), undefined);
  });

  it("disarms cadence when scheduleEnabled or cadence.enabled is false", () => {
    const off = resolveEnabledCommunitySchedules(CommunityEngagerManifest, {
      ...baseCfg,
      cadence: { ...baseCfg.cadence, scheduleEnabled: false },
    });
    assert.ok(!off.some((s) => s.id === CADENCE_SCHEDULE_ID));
    assert.ok(off.some((s) => s.id === "post_watch"));

    const cadenceOff = resolveEnabledCommunitySchedules(
      CommunityEngagerManifest,
      {
        ...baseCfg,
        cadence: { ...baseCfg.cadence, enabled: false },
      }
    );
    assert.ok(!cadenceOff.some((s) => s.id === CADENCE_SCHEDULE_ID));
  });

  it("disarms post_watch when postWatch.enabled is false", () => {
    const schedules = resolveEnabledCommunitySchedules(
      CommunityEngagerManifest,
      {
        ...baseCfg,
        postWatch: { ...baseCfg.postWatch, enabled: false },
      }
    );
    assert.ok(schedules.some((s) => s.id === CADENCE_SCHEDULE_ID));
    assert.ok(!schedules.some((s) => s.id === "post_watch"));
  });
});
