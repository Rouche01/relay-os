/**
 * Post-watch admin collection — queue watches + sweep history.
 * Source path = REDDIT_DATA_DIR (same root as authority).
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type {
  CollectionAdapter,
  GetResult,
  ListFilter,
  ListResult,
  PostWatchWatchViz,
  SeriesPayload,
  SeriesPoint,
  SourceConfig,
} from "@relay/admin-shell";
import { assertFileSource } from "./sources.js";
import {
  postWatchSweepsDir,
  readPostWatchQueue,
  type PostWatchEntry,
  type PostWatchPhase,
  type PostWatchSweepCandidate,
  type PostWatchSweepLog,
  type PostWatchSweepOutcome,
} from "../stages/post-watch/post-watch.js";

const SWEEP_SCAN_CAP = 200;

export interface PostWatchHistoryPoint {
  t: string;
  sweepId: string;
  phase: PostWatchPhase;
  outcome: PostWatchSweepOutcome;
  score?: number;
  replyCount?: number;
  fetchOk: boolean;
  fetchSource?: string;
  httpStatus?: number;
  error?: string;
}

/**
 * Browse enrolled watches and sweep polls.
 * List filter `status=sweeps` lists recent sweeps; otherwise lists queue watches
 * (optional status filter: pending|replied|removed|expired|error).
 */
export function createPostWatchCollection(
  source: SourceConfig
): CollectionAdapter {
  assertFileSource(source, "post-watch");
  const dataDir = source.path;

  return {
    id: "post-watch",
    label: "Post-watch",
    source,
    capabilities: {
      list: true,
      get: true,
      series: true,
    },

    async list(filter: ListFilter = {}): Promise<ListResult> {
      const status =
        typeof filter.status === "string" ? filter.status.trim() : "";
      const limit =
        typeof filter.limit === "number" && filter.limit >= 0
          ? filter.limit
          : undefined;

      if (status === "sweeps") {
        return listSweeps(dataDir, limit);
      }
      return listWatches(dataDir, {
        status: status || undefined,
        limit,
      });
    },

    async get(id: string): Promise<GetResult | null> {
      const rawId = id.trim();
      if (!rawId) return null;

      if (isSweepId(rawId)) {
        const sweep = await findSweepById(dataDir, stripSweepPrefix(rawId));
        if (!sweep) return null;
        return {
          record: sweep,
          detail: {
            kind: "json",
            title: sweep.sweepId,
            subtitle: `${sweep.startedAt} · checked ${sweep.checked} · success=${sweep.success}`,
          },
        };
      }

      const watchId = rawId;
      const queue = await readPostWatchQueue(dataDir);
      const watch = queue.watches.find((w) => w.id === watchId);
      if (!watch) return null;

      const history = await historyForWatch(dataDir, watchId);
      const viz: PostWatchWatchViz = {
        watchId: watch.id,
        subreddit: watch.subreddit,
        status: watch.status,
        postedUrl: watch.postedUrl,
        threadTitle: watch.threadTitle,
        lastScore: watch.lastScore,
        replyCount: watch.replyCount,
        lastFetchSource: watch.lastFetchSource,
        lastCheckedAt: watch.lastCheckedAt,
        expiresAt: watch.expiresAt,
        history,
      };

      return {
        record: { ...watch, history },
        detail: {
          kind: "post-watch-watch",
          title: `r/${watch.subreddit} · ${watch.status}`,
          subtitle: [
            watch.lastScore !== undefined ? `score ${watch.lastScore}` : null,
            watch.replyCount !== undefined
              ? `replies ${watch.replyCount}`
              : null,
            watch.lastFetchSource ?? null,
          ]
            .filter(Boolean)
            .join(" · "),
          viz,
        },
      };
    },

    async series(query: ListFilter = {}): Promise<SeriesPayload> {
      const watchId =
        (typeof query.watchId === "string" && query.watchId.trim()) ||
        (typeof query.id === "string" && query.id.trim()) ||
        "";
      if (!watchId) {
        return { points: [] };
      }
      const history = await historyForWatch(dataDir, watchId);
      const points: SeriesPoint[] = history.map((h) => ({
        t: h.t,
        runId: h.sweepId,
        score: h.score ?? undefined,
        replyCount: h.replyCount ?? 0,
        outcome: h.outcome,
        phase: h.phase,
        fetchOk: h.fetchOk,
      }));
      return { points };
    },
  };
}

async function listWatches(
  dataDir: string,
  opts: { status?: string; limit?: number }
): Promise<ListResult> {
  const queue = await readPostWatchQueue(dataDir);
  let watches = [...queue.watches];
  if (opts.status) {
    watches = watches.filter((w) => w.status === opts.status);
  }
  watches.sort((a, b) => {
    const at = Date.parse(a.lastCheckedAt ?? a.enrolledAt);
    const bt = Date.parse(b.lastCheckedAt ?? b.enrolledAt);
    return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0);
  });
  if (opts.limit !== undefined) watches = watches.slice(0, opts.limit);

  return {
    columns: [
      { key: "subreddit", label: "Sub" },
      { key: "status", label: "Status" },
      { key: "phase", label: "Phase" },
      { key: "score", label: "Score" },
      { key: "replies", label: "Replies" },
      { key: "lastChecked", label: "Checked" },
      { key: "preview", label: "Preview" },
    ],
    rows: watches.map(watchToRow),
  };
}

function watchToRow(w: PostWatchEntry): Record<string, unknown> {
  const phase = w.lastCheckedAt ? "sustained" : "first_look";
  return {
    id: w.id,
    subreddit: w.subreddit,
    status: w.status,
    phase,
    score: w.lastScore !== undefined ? String(w.lastScore) : "—",
    replies: w.replyCount !== undefined ? String(w.replyCount) : "—",
    lastChecked: w.lastCheckedAt ?? "—",
    preview: previewWatch(w),
  };
}

function previewWatch(w: PostWatchEntry): string {
  const title = w.threadTitle?.trim().slice(0, 60);
  if (title) return title;
  try {
    const u = new URL(w.postedUrl);
    return u.pathname.slice(0, 80);
  } catch {
    return w.postedUrl.slice(0, 80);
  }
}

async function listSweeps(
  dataDir: string,
  limit?: number
): Promise<ListResult> {
  const files = await listSweepFiles(dataDir, limit ?? 50);
  const rows: Record<string, unknown>[] = [];
  for (const f of files) {
    try {
      const raw = await readFile(f.abs, "utf8");
      const sweep = JSON.parse(raw) as PostWatchSweepLog;
      rows.push({
        id: `sweep:${sweep.sweepId}`,
        startedAt: sweep.startedAt,
        checked: String(sweep.checked),
        replied: String(sweep.replied),
        pending: String(sweep.pending),
        errors: String(sweep.errors),
        success: sweep.success ? "ok" : "fail",
        preview: `${sweep.candidateCount} candidate(s)`,
      });
    } catch {
      rows.push({
        id: path.basename(f.abs, ".json"),
        startedAt: new Date(f.mtimeMs).toISOString(),
        checked: "—",
        replied: "—",
        pending: "—",
        errors: "—",
        success: "—",
        preview: "(unreadable)",
      });
    }
  }
  return {
    columns: [
      { key: "startedAt", label: "Started" },
      { key: "checked", label: "Checked" },
      { key: "replied", label: "Replied" },
      { key: "pending", label: "Pending" },
      { key: "errors", label: "Errors" },
      { key: "success", label: "OK" },
      { key: "preview", label: "Preview" },
    ],
    rows,
  };
}

function isSweepId(id: string): boolean {
  return (
    id.startsWith("sweep:") ||
    id.startsWith("sweep-") ||
    id.startsWith("sweep_")
  );
}

function stripSweepPrefix(id: string): string {
  if (id.startsWith("sweep:")) return id.slice("sweep:".length);
  // bare sweepId already looks like sweep-mvh63…
  return id;
}

async function findSweepById(
  dataDir: string,
  sweepId: string
): Promise<PostWatchSweepLog | null> {
  const files = await listSweepFiles(dataDir, SWEEP_SCAN_CAP);
  for (const f of files) {
    try {
      const raw = await readFile(f.abs, "utf8");
      const sweep = JSON.parse(raw) as PostWatchSweepLog;
      if (sweep.sweepId === sweepId || f.name.includes(sweepId)) {
        return sweep;
      }
    } catch {
      /* skip */
    }
  }
  return null;
}

export async function historyForWatch(
  dataDir: string,
  watchId: string
): Promise<PostWatchHistoryPoint[]> {
  const files = await listSweepFiles(dataDir, SWEEP_SCAN_CAP);
  const points: PostWatchHistoryPoint[] = [];
  // Scan oldest→newest so history is chronological; files are newest-first.
  for (const f of [...files].reverse()) {
    try {
      const raw = await readFile(f.abs, "utf8");
      const sweep = JSON.parse(raw) as PostWatchSweepLog;
      const cands = Array.isArray(sweep.candidates) ? sweep.candidates : [];
      for (const c of cands) {
        if (c.watchId !== watchId) continue;
        points.push(candidateToHistory(sweep, c));
      }
    } catch {
      /* skip */
    }
  }
  return points;
}

function candidateToHistory(
  sweep: PostWatchSweepLog,
  c: PostWatchSweepCandidate
): PostWatchHistoryPoint {
  return {
    t: sweep.startedAt,
    sweepId: sweep.sweepId,
    phase: c.phase,
    outcome: c.outcome,
    score: c.score,
    replyCount: c.replyCount,
    fetchOk: c.fetchOk,
    fetchSource: c.fetchSource,
    httpStatus: c.httpStatus,
    error: c.error,
  };
}

async function listSweepFiles(
  dataDir: string,
  limit: number
): Promise<Array<{ name: string; abs: string; mtimeMs: number }>> {
  const dir = postWatchSweepsDir(dataDir);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw err;
  }
  const rows: Array<{ name: string; abs: string; mtimeMs: number }> = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const abs = path.join(dir, name);
    const st = await stat(abs);
    rows.push({ name, abs, mtimeMs: st.mtimeMs });
  }
  rows.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return rows.slice(0, Math.max(0, limit));
}
