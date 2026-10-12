import {
  DEFAULT_ENTRYPOINT,
  listEntrypointNames,
  listSchedules,
  resolveEntrypoint,
  type AgenticAppManifest,
  type ScheduleDefinition,
} from "@relay/protocol";
import { readScheduleEvidence, type ScheduleEvidence } from "@relay/scheduler";
import type {
  CollectionAdapter,
  GetResult,
  ListFilter,
  ListResult,
  SchedulesOverviewViz,
  SourceConfig,
} from "@relay/admin-shell";
import { CommunityEngagerManifest } from "../manifest.js";
import { getCommunityConfig } from "../reddit/config.js";
import { resolveCommunitySchedules } from "../schedule-resolve.js";
import { assertFileSource } from "./sources.js";

export interface SchedulesCollectionOptions {
  /** Defaults to {@link CommunityEngagerManifest}. */
  manifest?: AgenticAppManifest;
  /**
   * App-facing label for the protocol default entrypoint.
   * CommunityEngager CLI uses `engage`.
   */
  defaultEntrypointLabel?: string;
  /** When false, skip cadence/postWatch config merge (tests). Default true. */
  applyRuntimeConfig?: boolean;
}

/**
 * Admin collection: manifest entrypoints + schedules, with last/next from
 * `{dataDir}/schedules/*.evidence.json` when the scheduler has run.
 */
export function createSchedulesCollection(
  source: SourceConfig,
  options: SchedulesCollectionOptions = {}
): CollectionAdapter {
  assertFileSource(source, "schedules");
  const dataDir = source.path;
  const baseManifest = options.manifest ?? CommunityEngagerManifest;
  const defaultLabel = options.defaultEntrypointLabel ?? "engage";
  const applyRuntime = options.applyRuntimeConfig !== false;

  function activeManifest(): AgenticAppManifest {
    if (!applyRuntime) return baseManifest;
    const cfg = getCommunityConfig();
    const schedules = resolveCommunitySchedules(baseManifest, cfg);
    return { ...baseManifest, schedules };
  }

  return {
    id: "schedules",
    label: "Schedules",
    source,
    capabilities: {
      list: true,
      get: true,
    },

    async list(_filter: ListFilter = {}): Promise<ListResult> {
      const manifest = activeManifest();
      const overview = await buildOverview(dataDir, manifest, defaultLabel);
      const columns = [
        { key: "kind", label: "Kind" },
        { key: "id", label: "Id" },
        { key: "entrypoint", label: "Entrypoint" },
        { key: "timing", label: "Timing" },
        { key: "enabled", label: "On" },
        { key: "lastStatus", label: "Last" },
        { key: "nextRunAt", label: "Next due" },
        { key: "preview", label: "Preview" },
      ];

      const rows: Record<string, unknown>[] = [
        {
          id: "overview",
          kind: "overview",
          entrypoint: "—",
          timing: "—",
          enabled: "—",
          lastStatus: "—",
          nextRunAt: "—",
          preview: `${overview.entrypoints.length} entrypoints · ${overview.schedules.length} schedules`,
        },
      ];

      for (const ep of overview.entrypoints) {
        rows.push({
          id: `entrypoint:${ep.name}`,
          kind: "entrypoint",
          entrypoint: ep.name,
          timing: ep.stageNames.join(" → "),
          enabled: "—",
          lastStatus: "—",
          nextRunAt: "—",
          preview: ep.description,
        });
      }

      for (const s of overview.schedules) {
        rows.push({
          id: s.id,
          kind: "schedule",
          entrypoint: s.entrypoint,
          timing: formatTiming(s),
          enabled: s.enabled === false ? "off" : "on",
          lastStatus: s.lastStatus ?? "never",
          nextRunAt: s.nextRunAt ?? "—",
          preview: s.description ?? "",
        });
      }

      return { columns, rows };
    },

    async get(id: string): Promise<GetResult | null> {
      const manifest = activeManifest();
      const overview = await buildOverview(dataDir, manifest, defaultLabel);

      if (id === "overview" || id === "latest") {
        return {
          record: overview,
          detail: {
            kind: "schedules-overview",
            title: "Entrypoints & schedules",
            subtitle: `${manifest.name} · ${overview.schedules.length} schedule(s)`,
            viz: overview,
          },
        };
      }

      if (id.startsWith("entrypoint:")) {
        const name = id.slice("entrypoint:".length);
        const ep = overview.entrypoints.find((e) => e.name === name);
        if (!ep) return null;
        return {
          record: ep,
          detail: {
            kind: "schedules-overview",
            title: `Entrypoint · ${ep.isDefault ? `${ep.name} (default)` : ep.name}`,
            subtitle: ep.stageNames.join(" → "),
            viz: {
              entrypoints: [ep],
              schedules: overview.schedules.filter(
                (s) =>
                  s.entrypoint === name ||
                  (ep.isDefault &&
                    (s.entrypoint === DEFAULT_ENTRYPOINT ||
                      s.entrypoint === defaultLabel))
              ),
            },
          },
        };
      }

      const schedule = overview.schedules.find((s) => s.id === id);
      if (!schedule) return null;
      const def = listSchedules(manifest).find((s) => s.id === id);
      const evidence = await readScheduleEvidence(dataDir, id);
      return {
        record: { schedule: def, evidence, summary: schedule },
        detail: {
          kind: "schedules-overview",
          title: `Schedule · ${id}`,
          subtitle: nextSubtitle(schedule),
          viz: {
            entrypoints: overview.entrypoints.filter(
              (e) =>
                e.name === schedule.entrypoint ||
                (schedule.entrypoint === DEFAULT_ENTRYPOINT && e.isDefault)
            ),
            schedules: [schedule],
          },
        },
      };
    },
  };
}

async function buildOverview(
  dataDir: string,
  manifest: AgenticAppManifest,
  defaultLabel: string
): Promise<SchedulesOverviewViz> {
  const entrypoints = listEntrypointNames(manifest).map((name) => {
    const resolved = resolveEntrypoint(
      manifest,
      name === DEFAULT_ENTRYPOINT ? undefined : name
    );
    const isDefault = name === DEFAULT_ENTRYPOINT;
    return {
      name: isDefault ? defaultLabel : name,
      description: resolved.description,
      stageNames: resolved.stages.map((s) => s.name),
      isDefault,
    };
  });

  const schedules = await Promise.all(
    listSchedules(manifest).map(async (s) => {
      const evidence = await readScheduleEvidence(dataDir, s.id);
      return scheduleToViz(s, evidence);
    })
  );

  return { entrypoints, schedules };
}

function scheduleToViz(
  s: ScheduleDefinition,
  evidence: ScheduleEvidence | null
): SchedulesOverviewViz["schedules"][number] {
  return {
    id: s.id,
    entrypoint: s.entrypoint,
    enabled: s.enabled !== false,
    cron: s.cron,
    everyMs: s.every_ms,
    description: s.description,
    lastStatus: evidence?.lastStatus,
    lastFinishedAt: evidence?.lastFinishedAt,
    nextRunAt: evidence?.nextRunAt,
    runs: evidence?.runs ?? 0,
    lastError: evidence?.lastError,
  };
}

function formatTiming(s: {
  cron?: string;
  everyMs?: number;
}): string {
  if (s.cron) return `cron ${s.cron}`;
  if (s.everyMs != null && Number.isFinite(s.everyMs)) {
    const n = s.everyMs;
    if (n % 3_600_000 === 0) return `every ${n / 3_600_000}h`;
    if (n % 60_000 === 0) return `every ${n / 60_000}m`;
    if (n % 1000 === 0) return `every ${n / 1000}s`;
    return `every ${n}ms`;
  }
  return "—";
}

function nextSubtitle(
  s: SchedulesOverviewViz["schedules"][number]
): string {
  const parts = [
    `→ ${s.entrypoint}`,
    formatTiming(s),
    s.enabled === false ? "disabled" : "enabled",
  ];
  if (s.nextRunAt) parts.push(`next ${s.nextRunAt}`);
  else if (s.lastStatus) parts.push(`last ${s.lastStatus}`);
  return parts.join(" · ");
}
