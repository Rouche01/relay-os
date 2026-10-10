import { readdir, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type {
  CollectionAdapter,
  GetResult,
  ListFilter,
  ListResult,
  RunDebugViz,
  SeriesPayload,
  SeriesPoint,
  SourceConfig,
} from "@relay/admin-shell";
import { assertFileSource } from "./sources.js";

type RunJob = {
  id?: string;
  outcome?: string;
  subreddit?: string;
  threadTitle?: string;
  error?: string;
  postedUrl?: string;
  execute?: { ok?: boolean; postedUrl?: string; error?: string };
};

type RunRecord = {
  runId?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  summary?: {
    runState?: string;
    scouted?: number;
    skipped?: number;
    approved?: number;
    aborted?: number;
    failed?: number;
    jobs?: RunJob[];
    session?: { ok?: boolean; source?: string; error?: string };
    discover?: {
      ran?: boolean;
      enabled?: boolean;
      hitlWaitMs?: number;
      decision?: string;
      skippedReason?: string;
      candidateCount?: number;
    };
    scout?: {
      blockedCount?: number;
      timedOutCount?: number;
      opportunityCount?: number;
      listingOk?: boolean;
      challengeReason?: string;
      challengeSubreddit?: string;
      subs?: Array<{
        subreddit: string;
        status: string;
        opportunities: number;
        reason?: string;
      }>;
    };
  };
};

async function listJsonFiles(
  dir: string,
  limit?: number
): Promise<{ name: string; mtimeMs: number }[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw err;
  }
  const rows: { name: string; mtimeMs: number }[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const st = await stat(path.join(dir, name));
    rows.push({ name, mtimeMs: st.mtimeMs });
  }
  rows.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (limit !== undefined && limit >= 0) return rows.slice(0, limit);
  return rows;
}

async function readRun(
  dir: string,
  file: string
): Promise<RunRecord | null> {
  try {
    const raw = await readFile(path.join(dir, file), "utf8");
    return JSON.parse(raw) as RunRecord;
  } catch {
    return null;
  }
}

function inRange(endedAt: string | undefined, from?: string, to?: string): boolean {
  if (!endedAt) return true;
  if (from && endedAt < from) return false;
  if (to && endedAt > to) return false;
  return true;
}

function countPosted(jobs: RunJob[] | undefined): number {
  if (!Array.isArray(jobs)) return 0;
  return jobs.filter(
    (j) =>
      Boolean(j.postedUrl) ||
      Boolean(j.execute?.postedUrl) ||
      j.execute?.ok === true
  ).length;
}

function dominantOutcome(p: {
  approved: number;
  aborted: number;
  failed: number;
}): string {
  if (p.failed > 0 && p.failed >= p.aborted && p.failed >= p.approved) {
    return "failed";
  }
  if (p.aborted > 0 && p.aborted >= p.approved) return "aborted";
  if (p.approved > 0) return "approved";
  return "empty";
}

function buildRunDebugViz(data: RunRecord): RunDebugViz {
  const jobs = data.summary?.jobs ?? [];
  const approved = data.summary?.approved ?? 0;
  const aborted = data.summary?.aborted ?? 0;
  const failed = data.summary?.failed ?? 0;
  const scouted = data.summary?.scouted ?? 0;
  const session = data.summary?.session;
  const discover = data.summary?.discover;
  const scout = data.summary?.scout;

  const stages: RunDebugViz["stages"] = [
    {
      id: "session",
      label: "Session",
      ok: session ? session.ok !== false : undefined,
      note: session
        ? [session.source, session.error].filter(Boolean).join(" · ") || undefined
        : "not recorded",
    },
    {
      id: "discover",
      label: "Discover",
      ok: discover
        ? discover.enabled === false ||
          discover.decision === "promote" ||
          discover.decision === "skip" ||
          discover.decision === "none"
        : undefined,
      waitMs: discover?.hitlWaitMs,
      note: discover
        ? [
            discover.enabled === false ? "disabled" : discover.ran ? "ran" : "skipped",
            discover.decision,
            discover.skippedReason,
            discover.candidateCount != null
              ? `candidates=${discover.candidateCount}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : "not recorded",
    },
    {
      id: "scout",
      label: "Scout",
      ok: scout
        ? (scout.blockedCount ?? 0) === 0 && (scout.timedOutCount ?? 0) === 0
        : undefined,
      note: scout
        ? [
            scout.listingOk ? "listingOk" : "no-listing",
            `blocked=${scout.blockedCount ?? 0}`,
            `timedOut=${scout.timedOutCount ?? 0}`,
            scout.challengeReason
              ? `challenge:${scout.challengeSubreddit ?? "?"} (${scout.challengeReason})`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : "not recorded",
    },
    {
      id: "jobs",
      label: "Jobs",
      ok: jobs.length === 0 ? undefined : failed === 0,
      note: `${jobs.length} job(s) · ok ${approved} / abort ${aborted} / fail ${failed}`,
    },
  ];

  return {
    stages,
    jobs: jobs.map((j, i) => ({
      id: j.id ?? `job-${i}`,
      outcome: j.outcome ?? "unknown",
      subreddit: j.subreddit,
      title: j.threadTitle,
      error: j.error ?? j.execute?.error,
      postedUrl: j.postedUrl ?? j.execute?.postedUrl,
    })),
    scout: {
      blockedCount: scout?.blockedCount ?? 0,
      timedOutCount: scout?.timedOutCount ?? 0,
      listingOk: scout?.listingOk,
      subs: (scout?.subs ?? []).map((s) => ({
        subreddit: s.subreddit,
        status: s.status,
        opportunities: s.opportunities ?? 0,
        reason: s.reason,
      })),
    },
    funnel: {
      scouted,
      jobs: jobs.length,
      approved,
      aborted,
      failed,
      posted: countPosted(jobs),
    },
    durationMs: data.durationMs,
    runState: data.summary?.runState,
  };
}

function toSeriesPoint(fileId: string, data: RunRecord): SeriesPoint {
  const jobs = data.summary?.jobs;
  const approved = data.summary?.approved ?? 0;
  const aborted = data.summary?.aborted ?? 0;
  const failed = data.summary?.failed ?? 0;
  const jobCount = Array.isArray(jobs) ? jobs.length : 0;
  const posted = countPosted(jobs);
  const scouted = data.summary?.scouted ?? 0;
  const point = {
    t: data.endedAt!,
    runId: fileId,
    startedAt: data.startedAt,
    durationMs: data.durationMs ?? 0,
    scouted,
    skipped: data.summary?.skipped ?? 0,
    jobs: jobCount,
    approved,
    aborted,
    failed,
    posted,
    blockedCount: data.summary?.scout?.blockedCount ?? 0,
    timedOutCount: data.summary?.scout?.timedOutCount ?? 0,
    discoverHitlWaitMs: data.summary?.discover?.hitlWaitMs ?? 0,
    hasSession: data.summary?.session ? 1 : 0,
    hasDiscover: data.summary?.discover?.ran ? 1 : 0,
    listingOk: data.summary?.scout?.listingOk ? 1 : 0,
    runState: data.summary?.runState,
    outcome: dominantOutcome({ approved, aborted, failed }),
  };
  return point;
}

export function createRunsCollection(source: SourceConfig): CollectionAdapter {
  assertFileSource(source, "runs");
  const dir = source.path;

  return {
    id: "runs",
    label: "Runs",
    source,
    capabilities: {
      list: true,
      get: true,
      delete: true,
      series: true,
    },

    async list(filter: ListFilter = {}): Promise<ListResult> {
      const limit =
        typeof filter.limit === "number" ? filter.limit : undefined;
      const files = await listJsonFiles(dir, limit);
      const rows: Record<string, unknown>[] = [];
      for (const f of files) {
        const id = f.name.replace(/\.json$/, "");
        const data = await readRun(dir, f.name);
        if (!data) {
          rows.push({
            id,
            endedAt: new Date(f.mtimeMs).toISOString(),
            runState: "—",
            scouted: "—",
            jobs: "—",
            preview: "(unreadable)",
          });
          continue;
        }
        if (
          !inRange(
            data.endedAt,
            typeof filter.from === "string" ? filter.from : undefined,
            typeof filter.to === "string" ? filter.to : undefined
          )
        ) {
          continue;
        }
        const jobs = Array.isArray(data.summary?.jobs)
          ? data.summary.jobs.length
          : undefined;
        rows.push({
          id,
          endedAt: data.endedAt ?? new Date(f.mtimeMs).toISOString(),
          runState: data.summary?.runState ?? "—",
          scouted: data.summary?.scouted ?? "—",
          jobs: jobs ?? "—",
          preview: [
            data.summary?.runState,
            data.summary?.scouted != null
              ? `scouted=${data.summary.scouted}`
              : null,
            jobs != null ? `jobs=${jobs}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "—",
        });
      }
      return {
        columns: [
          { key: "endedAt", label: "Ended" },
          { key: "runState", label: "State" },
          { key: "scouted", label: "Scouted" },
          { key: "jobs", label: "Jobs" },
          { key: "preview", label: "Preview" },
        ],
        rows,
      };
    },

    async get(id: string): Promise<GetResult | null> {
      const file = id.endsWith(".json") ? id : `${id}.json`;
      const safe = path.basename(file);
      const record = await readRun(dir, safe);
      if (!record) return null;
      const viz = buildRunDebugViz(record);
      const dur =
        record.durationMs != null
          ? `${Math.round(record.durationMs / 1000)}s`
          : "";
      return {
        record,
        detail: {
          kind: "run-debug",
          title: String(record.runId ?? safe),
          subtitle: [record.endedAt, record.summary?.runState, dur]
            .filter(Boolean)
            .join(" · "),
          viz,
        },
      };
    },

    async delete(id: string): Promise<boolean> {
      const file = id.endsWith(".json") ? id : `${id}.json`;
      const safe = path.basename(file);
      try {
        await unlink(path.join(dir, safe));
        return true;
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return false;
        throw err;
      }
    },

    async series(query: ListFilter = {}): Promise<SeriesPayload> {
      const limit =
        typeof query.limit === "number" && query.limit > 0
          ? query.limit
          : 50;
      const files = await listJsonFiles(dir, limit);
      const chronological = [...files].reverse();
      const points: SeriesPoint[] = [];
      for (const f of chronological) {
        const data = await readRun(dir, f.name);
        if (!data?.endedAt) continue;
        if (!data.startedAt && data.durationMs != null) {
          const end = Date.parse(data.endedAt);
          if (Number.isFinite(end)) {
            data.startedAt = new Date(end - data.durationMs).toISOString();
          }
        }
        if (!data.startedAt) data.startedAt = data.endedAt;
        if (
          !inRange(
            data.endedAt,
            typeof query.from === "string" ? query.from : undefined,
            typeof query.to === "string" ? query.to : undefined
          )
        ) {
          continue;
        }
        points.push(toSeriesPoint(f.name.replace(/\.json$/, ""), data));
      }

      const funnel = {
        scouted: points.reduce((s, p) => s + (Number(p.scouted) || 0), 0),
        jobs: points.reduce((s, p) => s + (Number(p.jobs) || 0), 0),
        approved: points.reduce((s, p) => s + (Number(p.approved) || 0), 0),
        aborted: points.reduce((s, p) => s + (Number(p.aborted) || 0), 0),
        failed: points.reduce((s, p) => s + (Number(p.failed) || 0), 0),
        posted: points.reduce((s, p) => s + (Number(p.posted) || 0), 0),
      };

      return { points, funnel };
    },
  };
}
