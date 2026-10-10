import { readdir, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type {
  CollectionAdapter,
  GetResult,
  ListFilter,
  ListResult,
  SeriesPayload,
  SourceConfig,
} from "@relay/admin-shell";
import { assertFileSource } from "./sources.js";

type RunRecord = {
  runId?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  summary?: {
    runState?: string;
    scouted?: number;
    approved?: number;
    aborted?: number;
    failed?: number;
    jobs?: unknown[];
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
      return {
        record,
        detail: {
          kind: "json",
          title: String(record.runId ?? safe),
          subtitle: record.endedAt ?? safe,
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
      // chronological oldest → newest for charts
      const chronological = [...files].reverse();
      const points: SeriesPayload["points"] = [];
      for (const f of chronological) {
        const data = await readRun(dir, f.name);
        if (!data?.endedAt) continue;
        if (
          !inRange(
            data.endedAt,
            typeof query.from === "string" ? query.from : undefined,
            typeof query.to === "string" ? query.to : undefined
          )
        ) {
          continue;
        }
        points.push({
          t: data.endedAt,
          runId: f.name.replace(/\.json$/, ""),
          durationMs: data.durationMs ?? 0,
          scouted: data.summary?.scouted ?? 0,
          approved: data.summary?.approved ?? 0,
          aborted: data.summary?.aborted ?? 0,
          failed: data.summary?.failed ?? 0,
          jobs: Array.isArray(data.summary?.jobs)
            ? data.summary.jobs.length
            : 0,
          runState: data.summary?.runState,
        });
      }
      return { points };
    },
  };
}
