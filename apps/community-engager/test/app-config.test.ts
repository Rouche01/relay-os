import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  loadAppConfig,
  mergeConfig,
  resetAppConfigCache,
  resolveConfigDir,
} from "../src/app-config.js";
import { getCommunityConfig } from "../src/reddit/config.js";

describe("app-config", () => {
  let dir: string | undefined;

  afterEach(async () => {
    resetAppConfigCache();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("loads checked-in default.json from the package config dir", () => {
    const configDir = resolveConfigDir();
    assert.match(configDir, /community-engager[/\\]config$/);
    const cfg = loadAppConfig({ forceReload: true, configDir });
    assert.equal(cfg.warmup.mode, "auto");
    assert.equal(cfg.warmup.minHelpComments, 10);
    assert.equal(cfg.jobs.maxJobs, 3);
    assert.equal(cfg.scout.delayMs, 8000);
    assert.equal(cfg.postWatch.enabled, true);
    assert.equal(cfg.postWatch.minAgeHours, 24);
    assert.equal(cfg.postWatch.maxAgeHours, 72);
    assert.equal(cfg.cadence.enabled, true);
    assert.equal(cfg.cadence.maxHelpPerDay, 5);
    assert.equal(cfg.cadence.maxPromoPerDay, 1);
    assert.equal(cfg.cadence.scheduleEnabled, true);
    assert.equal(cfg.cadence.scheduleCron, "0 9,13,18 * * *");
    assert.equal(cfg.cadence.maxJobsPerRun, 2);
    assert.equal(cfg.visibility.enabled, true);
    assert.equal(cfg.visibility.delayMs, 3000);
    assert.match(cfg.discover.goal, /GoStylens/);
    assert.equal(cfg.discover.onEmptyScout, "off");
    assert.equal(cfg.discover.onEmptyScoutMax, 1);
    assert.equal(cfg.discover.onEmptyScoutMaxPerDay, 3);
  });

  it("merges local.json over default.json", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ce-config-"));
    await writeFile(
      path.join(dir, "default.json"),
      JSON.stringify({
        warmup: { mode: "auto", minHelpComments: 10 },
        jobs: { maxJobs: 3 },
      }),
      "utf8"
    );
    await writeFile(
      path.join(dir, "local.json"),
      JSON.stringify({
        warmup: { mode: "force", minHelpComments: 2 },
        scout: { maxSubs: 1 },
      }),
      "utf8"
    );

    const cfg = loadAppConfig({ forceReload: true, configDir: dir });
    assert.equal(cfg.warmup.mode, "force");
    assert.equal(cfg.warmup.minHelpComments, 2);
    assert.equal(cfg.scout.maxSubs, 1);
    assert.equal(cfg.jobs.maxJobs, 3);
  });

  it("mergeConfig skips underscore comment keys inside sections", () => {
    const cfg = mergeConfig({
      warmup: { mode: "off", _comment: "ignore me" } as never,
    });
    assert.equal(cfg.warmup.mode, "off");
  });
});

describe("getCommunityConfig policy + env override", () => {
  afterEach(() => {
    resetAppConfigCache();
    delete process.env.COMMUNITY_WARMUP;
    delete process.env.COMMUNITY_MAX_JOBS;
    delete process.env.SCOUT_SOURCE;
    delete process.env.COMMUNITY_DISCOVER_ON_EMPTY_SCOUT;
    delete process.env.COMMUNITY_DISCOVER_ON_EMPTY_SCOUT_MAX;
    delete process.env.COMMUNITY_DISCOVER_ON_EMPTY_SCOUT_MAX_PER_DAY;
  });

  it("uses file policy when env is unset", () => {
    const appConfig = mergeConfig({
      warmup: { mode: "force", minKarma: 50 },
      jobs: { maxJobs: 7, delayMs: 900 },
      scout: { source: "browser" },
      discover: { onEmptyScout: "force", onEmptyScoutMax: 2 },
    });
    const cfg = getCommunityConfig({}, { appConfig });
    assert.equal(cfg.warmup.mode, "force");
    assert.equal(cfg.warmup.minKarma, 50);
    assert.equal(cfg.jobs.maxJobs, 7);
    assert.equal(cfg.jobs.delayMs, 900);
    assert.equal(cfg.scout.source, "browser");
    assert.equal(cfg.discover.onEmptyScout, "force");
    assert.equal(cfg.discover.onEmptyScoutMax, 2);
    assert.equal(cfg.discover.onEmptyScoutMaxPerDay, 3);
  });

  it("lets env win over file policy", () => {
    const appConfig = mergeConfig({
      warmup: { mode: "force" },
      jobs: { maxJobs: 7 },
      scout: { source: "browser" },
      discover: { onEmptyScout: "off", onEmptyScoutMax: 1 },
    });
    const cfg = getCommunityConfig(
      {
        COMMUNITY_WARMUP: "off",
        COMMUNITY_MAX_JOBS: "2",
        SCOUT_SOURCE: "fixtures",
        COMMUNITY_DISCOVER_ON_EMPTY_SCOUT: "force",
        COMMUNITY_DISCOVER_ON_EMPTY_SCOUT_MAX: "2",
        COMMUNITY_DISCOVER_ON_EMPTY_SCOUT_MAX_PER_DAY: "5",
      },
      { appConfig }
    );
    assert.equal(cfg.warmup.mode, "off");
    assert.equal(cfg.jobs.maxJobs, 2);
    assert.equal(cfg.scout.source, "fixtures");
    assert.equal(cfg.discover.onEmptyScout, "force");
    assert.equal(cfg.discover.onEmptyScoutMax, 2);
    assert.equal(cfg.discover.onEmptyScoutMaxPerDay, 5);
  });
});
